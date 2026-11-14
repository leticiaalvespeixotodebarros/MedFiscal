/**
 * backend/src/tomadores/importacao.ts
 *
 * Importação automática de hospitais (tomadores) a partir das NFS-e que a
 * empresa do médico JÁ EMITIU.
 *
 * Fluxo:
 *  1. Usa o certificado da empresa (próprio ou padrão do .env, sempre
 *     conferido: mesmo CNPJ, dentro da validade).
 *  2. Lê a fila de NFS-e do CNPJ no ADN (src/nfse/distribuicaoAdn.ts —
 *     porta do baixador de notas), considerando só as notas EMITIDAS
 *     pela empresa nos últimos 24 meses — ou desde a abertura do CNPJ, se
 *     a empresa for mais nova.
 *  3. De cada nota emitida tira os dados do tomador (quem recebeu o
 *     serviço): CNPJ, razão social, endereço completo, código IBGE do
 *     município, e-mail, telefone, inscrição municipal.
 *  4. Cadastra/atualiza em `tomadores` do médico — sem sobrescrever nada
 *     que já estava preenchido (apelido e dados editados à mão ficam).
 *
 * Regras:
 *  - Nota cancelada (evento e101101/e105102/e105104/e305101) não conta.
 *    Hospital que só aparece em notas canceladas não é cadastrado.
 *  - Tomador pessoa física (CPF) ou do exterior é ignorado (contado no
 *    resumo) — o app trabalha com hospitais/clínicas (CNPJ).
 *  - A leitura é incremental: o NSU onde parou fica salvo na empresa;
 *    a próxima importação continua dali (só lê notas novas).
 */

import axios from "axios";
import { pool } from "../db";
import { obterCertificadoDaEmpresa } from "../nfse/certificadoEmpresa";
import {
  ambienteDeConsulta,
  chaveCanceladaDoEvento,
  dataDoDocumento,
  percorrerDistribuicao,
} from "../nfse/distribuicaoAdn";
import { ErroEmissaoNfse } from "../nfse/erros";

// ---------------------------------------------------------------------
// Extração do tomador a partir do XML da NFS-e
// ---------------------------------------------------------------------

export interface TomadorDaNota {
  cnpj: string | null;
  cpf: string | null;
  exterior: boolean;
  razaoSocial: string;
  inscricaoMunicipal: string | null;
  codigoMunicipioIbge: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  telefone: string | null;
  email: string | null;
}

function decodificarEntidades(t: string): string {
  return t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function tag(bloco: string, nome: string): string | null {
  const m = bloco.match(new RegExp(`<${nome}>([^<]*)</${nome}>`));
  return m ? decodificarEntidades(m[1]).trim() || null : null;
}

/** Lê o grupo <toma> (tomador) de uma NFS-e do padrão nacional. */
export function extrairTomadorDaNota(xml: string): TomadorDaNota | null {
  const m = xml.match(/<toma>([\s\S]*?)<\/toma>/);
  if (!m) return null;
  const bloco = m[1];
  const razaoSocial = tag(bloco, "xNome");
  if (!razaoSocial) return null;

  const endNac = bloco.match(/<endNac>([\s\S]*?)<\/endNac>/)?.[1] ?? "";
  return {
    cnpj: tag(bloco, "CNPJ"),
    cpf: tag(bloco, "CPF"),
    exterior: /<NIF>|<cNaoNIF>|<endExt>/.test(bloco),
    razaoSocial,
    inscricaoMunicipal: tag(bloco, "IM"),
    codigoMunicipioIbge: tag(endNac, "cMun"),
    cep: tag(endNac, "CEP"),
    logradouro: tag(bloco, "xLgr"),
    numero: tag(bloco, "nro"),
    complemento: tag(bloco, "xCpl"),
    bairro: tag(bloco, "xBairro"),
    telefone: tag(bloco, "fone"),
    email: tag(bloco, "email"),
  };
}

/** CNPJ do emitente (prestador) de uma NFS-e — grupo <emit>, ou <prest> da DPS. */
export function cnpjDoEmitente(xml: string): string | null {
  const emit = xml.match(/<emit>([\s\S]*?)<\/emit>/)?.[1] ?? xml.match(/<prest>([\s\S]*?)<\/prest>/)?.[1];
  return emit ? tag(emit, "CNPJ") : null;
}

export function chaveDaNota(xml: string, chaveDoLote: string): string {
  const m = xml.match(/<infNFSe[^>]*Id="NFS(\d{50})"/);
  return m ? m[1] : chaveDoLote;
}

// ---------------------------------------------------------------------
// Período e dados de apoio
// ---------------------------------------------------------------------

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Data de abertura do CNPJ (BrasilAPI). null se não der pra consultar. */
async function consultarDataAbertura(cnpj: string): Promise<string | null> {
  try {
    const r = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { timeout: 8000 });
    const d = r.data?.data_inicio_atividade;
    return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  } catch {
    return null;
  }
}

/** Município/UF (e e-mail/telefone, se a nota não trouxe) pelo CNPJ do hospital. */
async function complementarPelaBrasilApi(
  cnpj: string
): Promise<{ municipio: string | null; uf: string | null; email: string | null; telefone: string | null }> {
  try {
    const r = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { timeout: 8000 });
    return {
      municipio: r.data?.municipio ?? null,
      uf: r.data?.uf ?? null,
      email: r.data?.email ? String(r.data.email).toLowerCase() : null,
      telefone: r.data?.ddd_telefone_1 ? String(r.data.ddd_telefone_1).replace(/\D/g, "") : null,
    };
  } catch {
    return { municipio: null, uf: null, email: null, telefone: null };
  }
}

/** Início do período de busca: 24 meses atrás, ou a abertura do CNPJ se for depois. */
export function inicioDoPeriodo(hoje: Date, dataAbertura: string | null): string {
  const limite = new Date(hoje.getFullYear(), hoje.getMonth() - 24, hoje.getDate());
  const limiteIso = isoLocal(limite);
  return dataAbertura && dataAbertura > limiteIso ? dataAbertura : limiteIso;
}

function montarEnderecoTexto(t: {
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
}): string | null {
  const partes = [
    [t.logradouro, t.numero].filter(Boolean).join(", "),
    t.complemento,
    t.bairro,
    [t.municipio, t.uf].filter(Boolean).join("-"),
    t.cep ? `CEP ${t.cep}` : null,
  ].filter((p) => p && String(p).trim());
  return partes.length ? partes.join(", ") : null;
}

// ---------------------------------------------------------------------
// Importação
// ---------------------------------------------------------------------

export interface ResumoImportacao {
  periodoInicio: string;
  nsuInicial: number;
  nsuProximo: number;
  documentosLidos: number;
  notasEmitidasPeriodo: number;
  notasCanceladas: number;
  tomadoresNovos: number;
  tomadoresAtualizados: number;
  ignoradosPessoaFisica: number;
  completa: boolean;
  mensagem: string;
}

interface Acumulado {
  dados: TomadorDaNota;
  chaves: Set<string>;
  ultimaData: string;
}

export async function importarTomadoresDasNotas(
  medicoId: string,
  aoProgresso?: (p: { nsu: number; documentosLidos: number }) => void | Promise<void>
): Promise<ResumoImportacao> {
  const r = await pool.query(`SELECT * FROM empresas_emissoras WHERE medico_id = $1`, [medicoId]);
  const empresa = r.rows[0];
  if (!empresa) {
    throw new ErroEmissaoNfse(
      "Cadastre os dados da sua empresa (tela Minha Empresa) antes de importar os hospitais."
    );
  }

  const { certificado } = obterCertificadoDaEmpresa(empresa);

  let dataAbertura: string | null = empresa.data_abertura
    ? isoLocal(new Date(empresa.data_abertura))
    : null;
  if (!dataAbertura) {
    dataAbertura = await consultarDataAbertura(empresa.cnpj);
    if (dataAbertura) {
      await pool.query(`UPDATE empresas_emissoras SET data_abertura = $1 WHERE id = $2`, [
        dataAbertura,
        empresa.id,
      ]);
    }
  }
  const periodoInicio = inicioDoPeriodo(new Date(), dataAbertura);
  const nsuInicial = Number(empresa.importacao_nsu_proximo ?? 0);

  const porTomador = new Map<string, Acumulado>();
  const canceladas = new Set<string>();
  let notasEmitidasPeriodo = 0;
  let ignoradosPessoaFisica = 0;

  const percurso = await percorrerDistribuicao({
    cnpj: empresa.cnpj,
    certificado,
    ambiente: ambienteDeConsulta(),
    nsuInicial,
    aoProgresso,
    aoReceber: (doc) => {
      if (doc.classe === "eventos") {
        const ch = chaveCanceladaDoEvento(doc.xml);
        if (ch) canceladas.add(ch);
        return;
      }
      if (doc.classe !== "emitidas") return;
      // Confirma pelo grupo do emitente (o classificador do baixador olha
      // só o 1º CNPJ do XML).
      if (cnpjDoEmitente(doc.xml) !== empresa.cnpj) return;

      const data = dataDoDocumento(doc.xml) ?? doc.dataHoraGeracao?.slice(0, 10) ?? null;
      if (!data || data < periodoInicio) return;

      const tomador = extrairTomadorDaNota(doc.xml);
      if (!tomador) return;
      notasEmitidasPeriodo++;
      if (!tomador.cnpj || tomador.exterior) {
        ignoradosPessoaFisica++;
        return;
      }

      const chave = chaveDaNota(doc.xml, doc.chaveAcesso);
      const atual = porTomador.get(tomador.cnpj);
      if (!atual) {
        porTomador.set(tomador.cnpj, { dados: tomador, chaves: new Set([chave]), ultimaData: data });
      } else {
        atual.chaves.add(chave);
        // Guarda os dados da nota mais recente (endereço mais atualizado).
        if (data >= atual.ultimaData) {
          atual.dados = tomador;
          atual.ultimaData = data;
        }
      }
    },
  });

  let tomadoresNovos = 0;
  let tomadoresAtualizados = 0;

  for (const [cnpj, acumulado] of porTomador) {
    const validas = [...acumulado.chaves].filter((c) => !canceladas.has(c));
    if (validas.length === 0) continue; // só notas canceladas

    const t = acumulado.dados;
    const extra = await complementarPelaBrasilApi(cnpj);
    const enderecoTexto = montarEnderecoTexto({ ...t, municipio: extra.municipio, uf: extra.uf });

    const res = await pool.query(
      `INSERT INTO tomadores (
         medico_id, cnpj, razao_social, endereco, email, telefone,
         logradouro, numero, complemento, bairro, cep, codigo_municipio_ibge,
         municipio, uf, inscricao_municipal, origem, ultima_nota_em, qtd_notas_importadas
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'importado_nfse',$16,$17)
       ON CONFLICT (medico_id, cnpj) DO UPDATE SET
         endereco = COALESCE(tomadores.endereco, EXCLUDED.endereco),
         email = COALESCE(tomadores.email, EXCLUDED.email),
         telefone = COALESCE(tomadores.telefone, EXCLUDED.telefone),
         logradouro = COALESCE(tomadores.logradouro, EXCLUDED.logradouro),
         numero = COALESCE(tomadores.numero, EXCLUDED.numero),
         complemento = COALESCE(tomadores.complemento, EXCLUDED.complemento),
         bairro = COALESCE(tomadores.bairro, EXCLUDED.bairro),
         cep = COALESCE(tomadores.cep, EXCLUDED.cep),
         codigo_municipio_ibge = COALESCE(tomadores.codigo_municipio_ibge, EXCLUDED.codigo_municipio_ibge),
         municipio = COALESCE(tomadores.municipio, EXCLUDED.municipio),
         uf = COALESCE(tomadores.uf, EXCLUDED.uf),
         inscricao_municipal = COALESCE(tomadores.inscricao_municipal, EXCLUDED.inscricao_municipal),
         ultima_nota_em = GREATEST(tomadores.ultima_nota_em, EXCLUDED.ultima_nota_em),
         qtd_notas_importadas = tomadores.qtd_notas_importadas + EXCLUDED.qtd_notas_importadas
       RETURNING (xmax = 0) AS inserido`,
      [
        medicoId,
        cnpj,
        t.razaoSocial.slice(0, 200),
        enderecoTexto?.slice(0, 255) ?? null,
        (t.email ?? extra.email)?.slice(0, 150) ?? null,
        (t.telefone ?? extra.telefone)?.slice(0, 20) ?? null,
        t.logradouro?.slice(0, 200) ?? null,
        t.numero?.slice(0, 20) ?? null,
        t.complemento?.slice(0, 100) ?? null,
        t.bairro?.slice(0, 100) ?? null,
        t.cep?.replace(/\D/g, "").slice(0, 8) ?? null,
        t.codigoMunicipioIbge?.slice(0, 7) ?? null,
        extra.municipio?.slice(0, 100) ?? null,
        extra.uf?.slice(0, 2) ?? null,
        t.inscricaoMunicipal?.slice(0, 30) ?? null,
        acumulado.ultimaData,
        validas.length,
      ]
    );
    if (res.rows[0]?.inserido) tomadoresNovos++;
    else tomadoresAtualizados++;
    await new Promise((r) => setTimeout(r, 300)); // gentileza com a BrasilAPI
  }

  // Salva onde parou (próxima importação só lê notas novas).
  await pool.query(`UPDATE empresas_emissoras SET importacao_nsu_proximo = $1 WHERE id = $2`, [
    percurso.nsuProximo,
    empresa.id,
  ]);

  const completa = percurso.fimDaFila && !percurso.erro;
  let mensagem: string;
  if (percurso.erro) {
    mensagem = `A leitura das notas parou com erro do governo (${percurso.erro}). O que já foi lido foi importado; tente de novo mais tarde — continua de onde parou.`;
  } else if (percurso.parouPorLimite) {
    mensagem =
      "O governo limitou as consultas (muitas requisições). O que já foi lido foi importado; a próxima importação continua de onde parou.";
  } else if (!percurso.fimDaFila) {
    mensagem = "Muitas notas pra ler de uma vez — importe de novo pra continuar de onde parou.";
  } else if (tomadoresNovos + tomadoresAtualizados === 0) {
    mensagem =
      notasEmitidasPeriodo === 0
        ? "Nenhuma nota emitida no período foi encontrada para essa empresa."
        : "Nenhum hospital novo encontrado nas notas emitidas.";
  } else {
    mensagem = `${tomadoresNovos} hospital(is) novo(s) cadastrado(s) e ${tomadoresAtualizados} atualizado(s) a partir das notas emitidas.`;
  }

  return {
    periodoInicio,
    nsuInicial,
    nsuProximo: percurso.nsuProximo,
    documentosLidos: percurso.documentosLidos,
    notasEmitidasPeriodo,
    notasCanceladas: canceladas.size,
    tomadoresNovos,
    tomadoresAtualizados,
    ignoradosPessoaFisica,
    completa,
    mensagem,
  };
}

// ---------------------------------------------------------------------
// Execução em segundo plano (com acompanhamento de status)
// ---------------------------------------------------------------------

/** Importação parada há mais que isso (ex: servidor reiniciou) é dada como interrompida. */
const LIMITE_SEM_ATUALIZACAO_MIN = 15;

export async function ultimaImportacao(medicoId: string) {
  await pool.query(
    `UPDATE importacoes_tomadores
        SET status = 'erro', mensagem = 'Importação interrompida (o servidor foi reiniciado?). Importe de novo — continua de onde parou.',
            concluido_em = now()
      WHERE medico_id = $1 AND status = 'executando'
        AND atualizado_em < now() - ($2 || ' minutes')::interval`,
    [medicoId, String(LIMITE_SEM_ATUALIZACAO_MIN)]
  );
  const r = await pool.query(
    `SELECT * FROM importacoes_tomadores WHERE medico_id = $1 ORDER BY iniciado_em DESC LIMIT 1`,
    [medicoId]
  );
  return r.rows[0] ?? null;
}

/**
 * Dispara a importação em segundo plano e devolve o registro dela na hora
 * (a tela acompanha pelo status). Se já houver uma rodando pro médico,
 * devolve essa em vez de abrir outra.
 */
export async function iniciarImportacaoEmSegundoPlano(
  medicoId: string,
  motivo: "manual" | "certificado_cadastrado" | "script"
) {
  const atual = await ultimaImportacao(medicoId);
  if (atual?.status === "executando") return atual;

  const ins = await pool.query(
    `INSERT INTO importacoes_tomadores (medico_id, motivo) VALUES ($1, $2) RETURNING *`,
    [medicoId, motivo]
  );
  const registro = ins.rows[0];

  void (async () => {
    try {
      const resumo = await importarTomadoresDasNotas(medicoId, async (p) => {
        await pool.query(
          `UPDATE importacoes_tomadores SET nsu_atual = $1, documentos_lidos = $2, atualizado_em = now() WHERE id = $3`,
          [p.nsu, p.documentosLidos, registro.id]
        );
      });
      await pool.query(
        `UPDATE importacoes_tomadores
            SET status = $1, periodo_inicio = $2, nsu_inicial = $3, nsu_atual = $4,
                documentos_lidos = $5, notas_emitidas_periodo = $6, notas_canceladas = $7,
                tomadores_novos = $8, tomadores_atualizados = $9, ignorados_pessoa_fisica = $10,
                mensagem = $11, atualizado_em = now(), concluido_em = now()
          WHERE id = $12`,
        [
          resumo.completa ? "concluida" : "parcial",
          resumo.periodoInicio,
          resumo.nsuInicial,
          resumo.nsuProximo,
          resumo.documentosLidos,
          resumo.notasEmitidasPeriodo,
          resumo.notasCanceladas,
          resumo.tomadoresNovos,
          resumo.tomadoresAtualizados,
          resumo.ignoradosPessoaFisica,
          resumo.mensagem,
          registro.id,
        ]
      );
    } catch (err: any) {
      console.error("Erro na importação de hospitais:", err);
      await pool
        .query(
          `UPDATE importacoes_tomadores SET status = 'erro', mensagem = $1, atualizado_em = now(), concluido_em = now() WHERE id = $2`,
          [
            err instanceof ErroEmissaoNfse
              ? err.message
              : `Não foi possível importar: ${err?.message ?? "erro desconhecido"}`,
            registro.id,
          ]
        )
        .catch(() => undefined);
    }
  })();

  return registro;
}
