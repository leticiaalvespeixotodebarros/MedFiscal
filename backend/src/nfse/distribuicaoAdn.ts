/**
 * backend/src/nfse/distribuicaoAdn.ts
 *
 * Consulta as NFS-e de um CNPJ no Ambiente de Dados Nacional (ADN), pela
 * fila de distribuição por NSU:
 *   GET {adn}/contribuintes/DFe/{nsu}?cnpjConsulta={cnpj}&lote=true
 * autenticado (mTLS) com o certificado da PRÓPRIA empresa — procuração
 * do e-CAC não dá acesso a essa API, só o certificado do CNPJ.
 *
 * Portado de um baixador de notas em Python: mesma API, mesma leitura dos lotes
 * (LoteDFe → ArquivoXml em GZip+Base64), mesma classificação
 * emitida/recebida/evento, mesmo reconhecimento de eventos que cancelam a
 * nota e mesmo tratamento do limite de requisições (HTTP 429), com espera
 * crescente e retomada pelo NSU salvo.
 *
 * Diferença: aqui nada é gravado em disco — cada documento é entregue a
 * um callback (a importação de hospitais lê só o que precisa do XML).
 */

import axios from "axios";
import zlib from "zlib";
import {
  AmbienteNfse,
  CertificadoA1,
  criarAgenteHttpsComCertificado,
  obterUrlBaseAdn,
} from "./certificado";

export type ClasseDocumento = "emitidas" | "recebidas" | "eventos" | "outros";

export interface DocumentoAdn {
  nsu: number;
  chaveAcesso: string;
  dataHoraGeracao: string | null;
  xml: string;
  classe: ClasseDocumento;
}

/** Eventos que efetivamente cancelam a nota (mesma lista do baixador):
 * e101101 cancelamento | e105102 cancelamento por substituição |
 * e105104 cancelamento deferido por análise fiscal | e305101 por ofício. */
const EVENTOS_QUE_CANCELAM = ["e101101", "e105102", "e105104", "e305101"];

export function descompactarDocumento(conteudoB64Gzip: string): string {
  return zlib.gunzipSync(Buffer.from(conteudoB64Gzip, "base64")).toString("utf-8");
}

/** Mesma regra do baixador: o 1º CNPJ do XML é o do emitente. */
export function classificarDocumento(xml: string, cnpjConsultado: string): ClasseDocumento {
  if (/<evento[ >]/.test(xml)) return "eventos";
  const m = xml.match(/<CNPJ>(\d{14})<\/CNPJ>/) ?? xml.match(/<Cnpj>(\d{14})<\/Cnpj>/);
  if (!m) return "outros";
  return m[1] === cnpjConsultado ? "emitidas" : "recebidas";
}

/** Se o XML é um evento que cancela uma nota, devolve a chave cancelada. */
export function chaveCanceladaDoEvento(xml: string): string | null {
  const m = xml.match(/<chNFSe>(\d{50})<\/chNFSe>/);
  if (m && EVENTOS_QUE_CANCELAM.some((t) => xml.includes(`<${t}>`) || xml.includes(`<${t} `))) {
    return m[1];
  }
  return null;
}

/** Data de referência do documento (competência/processamento), "AAAA-MM-DD". */
export function dataDoDocumento(xml: string): string | null {
  for (const tag of ["dCompet", "dhProc", "dhEmi", "dhEvento"]) {
    const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
    if (m) return m[1].slice(0, 10);
  }
  return null;
}

/**
 * Ambiente do ADN usado pra LER notas (não emite nada). Padrão:
 * PRODUÇÃO — é lá que estão as notas reais já emitidas pela empresa
 * (no ambiente de testes só existem notas de teste). Consultar não tem
 * efeito fiscal, então não depende da trava NFSE_PERMITIR_PRODUCAO.
 * Pra ler o ambiente de testes: NFSE_IMPORTACAO_AMBIENTE=homologacao.
 */
export function ambienteDeConsulta(): AmbienteNfse {
  return process.env.NFSE_IMPORTACAO_AMBIENTE === "homologacao" ? "homologacao" : "producao";
}

export interface ResultadoPercurso {
  /** NSU a usar na próxima consulta (retomada incremental). */
  nsuProximo: number;
  documentosLidos: number;
  /** true = chegou ao fim da fila disponível. */
  fimDaFila: boolean;
  /** true = parou por limite de requisições persistente (retomar depois). */
  parouPorLimite: boolean;
  /** Erro HTTP inesperado (parou sem chegar ao fim). */
  erro: string | null;
}

const ESPERA_ENTRE_PAGINAS_MS = 1000;
const MAX_TENTATIVAS_429 = 4;

function dormir(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Percorre a fila de distribuição a partir de `nsuInicial`, entregando cada
 * documento a `aoReceber`. Sempre devolve o NSU seguro pra retomar.
 */
export async function percorrerDistribuicao(opcoes: {
  cnpj: string;
  certificado: CertificadoA1;
  ambiente?: AmbienteNfse;
  nsuInicial: number;
  aoReceber: (doc: DocumentoAdn) => void | Promise<void>;
  aoProgresso?: (info: { nsu: number; documentosLidos: number }) => void | Promise<void>;
  /** Limite de segurança de páginas por execução (padrão 500). */
  maxPaginas?: number;
}): Promise<ResultadoPercurso> {
  const ambiente = opcoes.ambiente ?? ambienteDeConsulta();
  const agente = criarAgenteHttpsComCertificado(opcoes.certificado);
  const base = `${obterUrlBaseAdn(ambiente)}/contribuintes/DFe`;
  const maxPaginas = opcoes.maxPaginas ?? 500;

  let nsu = opcoes.nsuInicial;
  let documentosLidos = 0;
  let tentativas429 = 0;

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const resp = await axios.get(`${base}/${nsu}`, {
      params: { cnpjConsulta: opcoes.cnpj, lote: "true" },
      httpsAgent: agente,
      timeout: 60000,
      validateStatus: () => true,
    });

    if (resp.status === 404) {
      return { nsuProximo: nsu, documentosLidos, fimDaFila: true, parouPorLimite: false, erro: null };
    }

    if (resp.status === 429) {
      tentativas429++;
      if (tentativas429 > MAX_TENTATIVAS_429) {
        return { nsuProximo: nsu, documentosLidos, fimDaFila: false, parouPorLimite: true, erro: null };
      }
      // 1, 2, 4, 5 min (o baixador usa até 15 min; aqui a importação
      // retoma do NSU salvo na próxima vez, então não precisa esperar tanto).
      await dormir(Math.min(60_000 * 2 ** (tentativas429 - 1), 300_000));
      continue;
    }

    if (resp.status !== 200) {
      const corpo = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data ?? "");
      return {
        nsuProximo: nsu,
        documentosLidos,
        fimDaFila: false,
        parouPorLimite: false,
        erro: `HTTP ${resp.status}: ${corpo.slice(0, 300)}`,
      };
    }
    tentativas429 = 0;

    const lote: any[] = resp.data?.LoteDFe ?? [];
    if (lote.length === 0) {
      return { nsuProximo: nsu, documentosLidos, fimDaFila: true, parouPorLimite: false, erro: null };
    }

    let maiorNsu = nsu - 1;
    for (const item of lote) {
      const nsuItem = Number(item.NSU ?? nsu);
      maiorNsu = Math.max(maiorNsu, nsuItem);
      let xml: string;
      try {
        xml = descompactarDocumento(item.ArquivoXml);
      } catch {
        continue; // documento corrompido: pula, mas o NSU avança
      }
      documentosLidos++;
      await opcoes.aoReceber({
        nsu: nsuItem,
        chaveAcesso: String(item.ChaveAcesso ?? ""),
        dataHoraGeracao: item.DataHoraGeracao ?? null,
        xml,
        classe: classificarDocumento(xml, opcoes.cnpj),
      });
    }

    nsu = maiorNsu + 1;
    await opcoes.aoProgresso?.({ nsu, documentosLidos });
    await dormir(ESPERA_ENTRE_PAGINAS_MS);
  }

  // Atingiu o limite de páginas desta execução — retoma do NSU na próxima.
  return { nsuProximo: nsu, documentosLidos, fimDaFila: false, parouPorLimite: false, erro: null };
}
