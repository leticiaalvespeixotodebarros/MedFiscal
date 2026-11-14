/**
 * backend/src/nfse/cancelamento.ts
 *
 * Cancelamento REAL de NFS-e no Sistema Nacional — evento e101101
 * ("Cancelamento de NFS-e"):
 *   1. monta o Pedido de Registro de Evento (pedRegEvento, leiaute 1.00);
 *   2. assina o <infPedReg> com o certificado da empresa (mesmo padrão
 *      XMLDSig da DPS);
 *   3. compacta (GZip) + Base64 e envia em
 *      POST {sefin}/nfse/{chaveAcesso}/eventos
 *      no campo "pedidoRegistroEventoXmlGZipB64" (NÃO "dpsXmlGZipB64").
 *
 * Leiaute conferido em XMLs reais aceitos pela Sefin Nacional (fórum do
 * Projeto ACBr) + tabela de campos da NT: cMotivo 1=Erro na emissão,
 * 2=Serviço não prestado, 9=Outros; xMotivo com 15 a 255 caracteres.
 *
 * Ponto de incerteza documentado: o Id do <infPedReg> é "PRE" + chave
 * (50) + código do evento (101101). Algumas versões do leiaute exigem
 * mais 3 dígitos de sequência no fim ("001"). Se o governo rejeitar o
 * primeiro formato por erro de esquema no Id, tentamos o segundo
 * automaticamente — cancelar é idempotente do lado do governo (um
 * segundo pedido pra mesma nota é recusado, nunca duplica nada).
 */

import axios from "axios";
import zlib from "zlib";
import { pool } from "../db";
import { assinarElementoXml } from "./assinatura";
import {
  AmbienteNfse,
  CertificadoA1,
  criarAgenteHttpsComCertificado,
  obterUrlBaseSefin,
} from "./certificado";
import { obterContextoEmissao } from "./certificadoEmpresa";
import { dataHoraAtualBrasilia, escaparXml } from "./dps";
import { ErroEmissaoNfse } from "./erros";
import { registrarFaturamentoAutomatico } from "./simples-nacional";

export type MotivoCancelamento = 1 | 2 | 9;

export const DESCRICAO_MOTIVO: Record<MotivoCancelamento, string> = {
  1: "Erro na emissao",
  2: "Servico nao prestado",
  9: "Outros",
};

interface DadosPedidoCancelamento {
  chaveAcesso: string;
  ambiente: AmbienteNfse;
  cnpjAutor: string;
  cMotivo: MotivoCancelamento;
  xMotivo: string;
  /** Sufixo opcional do Id (ver comentário do topo). */
  sufixoId?: string;
}

/** Garante 15–255 caracteres (regra do leiaute pro xMotivo). */
export function normalizarJustificativa(texto: string, cMotivo: MotivoCancelamento): string {
  let t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 15) {
    t = `${DESCRICAO_MOTIVO[cMotivo]}${t ? ` - ${t}` : ""}`;
  }
  if (t.length < 15) t = `${t} (cancelamento)`;
  return t.slice(0, 255);
}

export function montarPedidoCancelamentoXml(d: DadosPedidoCancelamento): {
  xml: string;
  idInfPedReg: string;
} {
  const idInfPedReg = `PRE${d.chaveAcesso}101101${d.sufixoId ?? ""}`;
  const tpAmb = d.ambiente === "producao" ? "1" : "2";

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">` +
    `<infPedReg Id="${idInfPedReg}">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<verAplic>MedFiscal_0.1.0</verAplic>` +
    `<dhEvento>${dataHoraAtualBrasilia()}</dhEvento>` +
    `<CNPJAutor>${d.cnpjAutor}</CNPJAutor>` +
    `<chNFSe>${d.chaveAcesso}</chNFSe>` +
    `<e101101>` +
    `<xDesc>Cancelamento de NFS-e</xDesc>` +
    `<cMotivo>${d.cMotivo}</cMotivo>` +
    `<xMotivo>${escaparXml(d.xMotivo)}</xMotivo>` +
    `</e101101>` +
    `</infPedReg>` +
    `</pedRegEvento>`;

  return { xml, idInfPedReg };
}

export interface ResultadoEnvioEvento {
  status: number;
  corpoResposta: any;
  xmlEnviado: string;
}

async function enviarPedidoEvento(
  chaveAcesso: string,
  xmlAssinado: string,
  certificado: CertificadoA1,
  ambiente: AmbienteNfse
): Promise<ResultadoEnvioEvento> {
  const b64 = zlib.gzipSync(Buffer.from(xmlAssinado, "utf-8")).toString("base64");
  const resposta = await axios.post(
    `${obterUrlBaseSefin(ambiente)}/nfse/${chaveAcesso}/eventos`,
    { pedidoRegistroEventoXmlGZipB64: b64 },
    {
      httpsAgent: criarAgenteHttpsComCertificado(certificado),
      timeout: 30000,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
    }
  );
  return { status: resposta.status, corpoResposta: resposta.data, xmlEnviado: xmlAssinado };
}

function erroEhDoIdDoPedido(corpo: any): boolean {
  const texto = JSON.stringify(corpo ?? "").toLowerCase();
  return texto.includes("id") && (texto.includes("pattern") || texto.includes("padrão") || texto.includes("padrao") || texto.includes("infpedreg"));
}

/** Extrai uma mensagem legível dos erros devolvidos pelo governo. */
export function mensagemDosErrosDoGoverno(corpo: any): string {
  const lista = corpo?.erros ?? corpo?.erro ?? corpo?.lote?.[0]?.erros ?? [];
  if (Array.isArray(lista) && lista.length > 0) {
    return lista
      .map((e: any) =>
        [e.Codigo ?? e.codigo, e.Descricao ?? e.descricao, e.Complemento ?? e.complemento]
          .filter(Boolean)
          .join(" - ")
      )
      .join(" | ");
  }
  return typeof corpo === "string" ? corpo.slice(0, 500) : "Resposta sem detalhes de erro.";
}

export interface ResultadoCancelamento {
  sucesso: boolean;
  emissaoId: string;
  chaveAcesso: string;
  status: number;
  mensagem: string;
  respostaGoverno: any;
}

/**
 * Cancela no governo a NFS-e de uma emissão do histórico (nfse_emissoes),
 * conferindo que ela é do médico autenticado e que deu certo antes.
 * Em caso de sucesso: marca a emissão como "cancelada" e estorna o valor
 * do faturamento do mês (RBT12 do cálculo do Simples Nacional).
 *
 * Lança ErroEmissaoNfse pra problemas esperados (nota não encontrada,
 * já cancelada, certificado/ambiente).
 */
export async function cancelarNfse(
  medicoId: string,
  filtro: { emissaoId?: string; chaveAcesso?: string },
  cMotivo: MotivoCancelamento,
  justificativa: string
): Promise<ResultadoCancelamento> {
  const r = await pool.query(
    `SELECT * FROM nfse_emissoes
      WHERE medico_id = $1
        AND (($2::uuid IS NOT NULL AND id = $2::uuid) OR ($3::text IS NOT NULL AND chave_acesso = $3::text))
      ORDER BY created_at DESC LIMIT 1`,
    [medicoId, filtro.emissaoId ?? null, filtro.chaveAcesso ?? null]
  );
  if (r.rows.length === 0) {
    throw new ErroEmissaoNfse("NFS-e não encontrada no histórico de emissões deste médico.");
  }
  const emissao = r.rows[0];

  if (emissao.status === "cancelada") {
    throw new ErroEmissaoNfse("Essa NFS-e já foi cancelada.");
  }
  if (emissao.status !== "sucesso" || !emissao.chave_acesso) {
    throw new ErroEmissaoNfse(
      "Só dá pra cancelar uma NFS-e que foi emitida com sucesso (com chave de acesso)."
    );
  }

  const empresaResult = await pool.query(
    `SELECT * FROM empresas_emissoras WHERE medico_id = $1`,
    [medicoId]
  );
  const empresa = empresaResult.rows[0];
  if (!empresa) {
    throw new ErroEmissaoNfse("Nenhuma empresa emissora cadastrada para este médico.");
  }
  if (empresa.cnpj !== emissao.cnpj_prestador) {
    throw new ErroEmissaoNfse(
      `Essa nota foi emitida pelo CNPJ ${emissao.cnpj_prestador}, diferente da empresa emissora atual (${empresa.cnpj}). Cancele pelo emissor do governo com o certificado daquela empresa.`
    );
  }

  const contexto = obterContextoEmissao(empresa);
  if (contexto.ambiente !== emissao.ambiente) {
    throw new ErroEmissaoNfse(
      `Essa nota foi emitida em ${emissao.ambiente}, mas a empresa agora está em ${contexto.ambiente}. Volte a empresa pro ambiente da nota pra cancelar.`
    );
  }

  const xMotivo = normalizarJustificativa(justificativa, cMotivo);

  let resultado: ResultadoEnvioEvento | null = null;
  for (const sufixoId of ["", "001"]) {
    const { xml, idInfPedReg } = montarPedidoCancelamentoXml({
      chaveAcesso: emissao.chave_acesso,
      ambiente: contexto.ambiente,
      cnpjAutor: empresa.cnpj,
      cMotivo,
      xMotivo,
      sufixoId,
    });
    const assinado = assinarElementoXml(xml, idInfPedReg, "infPedReg", contexto.certificado);
    resultado = await enviarPedidoEvento(
      emissao.chave_acesso,
      assinado,
      contexto.certificado,
      contexto.ambiente
    );
    const ok = resultado.status >= 200 && resultado.status < 300;
    if (ok || !erroEhDoIdDoPedido(resultado.corpoResposta)) break;
  }

  const sucesso = !!resultado && resultado.status >= 200 && resultado.status < 300;

  if (sucesso) {
    await pool.query(
      `UPDATE nfse_emissoes
          SET status = 'cancelada', cancelada_em = now(), cancelamento_motivo = $1,
              cancelamento_resposta = $2, updated_at = now()
        WHERE id = $3`,
      [`${cMotivo} - ${xMotivo}`, JSON.stringify(resultado!.corpoResposta), emissao.id]
    );
    // Estorna do faturamento do mês da competência (mantém o RBT12 certo).
    const competencia =
      emissao.data_competencia instanceof Date
        ? `${emissao.data_competencia.getFullYear()}-${String(emissao.data_competencia.getMonth() + 1).padStart(2, "0")}-01`
        : String(emissao.data_competencia).slice(0, 10);
    await registrarFaturamentoAutomatico(empresa.id, competencia, -Number(emissao.valor));
  } else {
    await pool.query(
      `UPDATE nfse_emissoes SET cancelamento_resposta = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(resultado?.corpoResposta ?? null), emissao.id]
    );
  }

  return {
    sucesso,
    emissaoId: emissao.id,
    chaveAcesso: emissao.chave_acesso,
    status: resultado?.status ?? 0,
    mensagem: sucesso
      ? "NFS-e cancelada no Sistema Nacional."
      : `O governo recusou o cancelamento: ${mensagemDosErrosDoGoverno(resultado?.corpoResposta)}`,
    respostaGoverno: resultado?.corpoResposta ?? null,
  };
}
