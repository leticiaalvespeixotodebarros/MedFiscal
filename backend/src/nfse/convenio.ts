/**
 * backend/src/nfse/convenio.ts
 *
 * Consulta no governo se um município já aderiu (tem convênio) ao
 * Sistema Nacional da NFS-e — API "Parâmetros Municipais":
 *   GET /parametros_municipais/{codigoMunicipio}/convenio
 * (Manual dos Contribuintes — APIs do Emissor Público Nacional, v1.2).
 *
 * Motivação: no caso de um município, a informação por telefone da prefeitura
 * ("só a partir de 01/11/2026") não bateu com o que de fato aconteceu.
 * Consultar direto a fonte evita esse tipo de dúvida.
 *
 * A estrutura exata da resposta não está 100% documentada publicamente,
 * então a interpretação é feita com cuidado: procura campos de adesão
 * ("aderente...") e, se não encontrar, devolve "indeterminado" junto com
 * a resposta bruta do governo — nunca inventa um sim/não.
 * Por isso essa consulta é só INFORMATIVA: não bloqueia emissão.
 */

import axios from "axios";
import {
  CertificadoA1,
  ambientePadraoDoEnv,
  AmbienteNfse,
  criarAgenteHttpsComCertificado,
  obterCertificadoDoEnv,
  obterUrlBaseAdn,
  obterUrlBaseSefin,
} from "./certificado";
import { EmpresaComCertificado, obterContextoEmissao } from "./certificadoEmpresa";

export interface ResultadoConvenio {
  codigoMunicipio: string;
  ambiente: AmbienteNfse;
  /** true = aderiu; false = não aderiu; null = não deu pra concluir. */
  aderente: boolean | null;
  resumo: string;
  urlConsultada: string | null;
  statusHttp: number | null;
  respostaGoverno: unknown;
  consultadoEm: string;
}

const CACHE_MS = 6 * 60 * 60 * 1000; // 6 horas
const cache = new Map<string, { em: number; resultado: ResultadoConvenio }>();

/** Procura recursivamente campos de adesão (ex: "aderenteAmbienteNacional"). */
function procurarCamposAdesao(obj: unknown, caminho = ""): { campo: string; valor: unknown }[] {
  const achados: { campo: string; valor: unknown }[] = [];
  if (obj && typeof obj === "object") {
    for (const [chave, valor] of Object.entries(obj as Record<string, unknown>)) {
      const atual = caminho ? `${caminho}.${chave}` : chave;
      if (/ader/i.test(chave) && (typeof valor !== "object" || valor === null)) {
        achados.push({ campo: atual, valor });
      }
      achados.push(...procurarCamposAdesao(valor, atual));
    }
  }
  return achados;
}

function valorVerdadeiro(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["1", "true", "s", "sim"].includes(t)) return true;
    if (["0", "2", "false", "n", "nao", "não"].includes(t)) return false;
  }
  return null;
}

export async function consultarConvenioMunicipio(
  codigoMunicipio: string,
  empresa?: EmpresaComCertificado
): Promise<ResultadoConvenio> {
  if (!/^\d{7}$/.test(codigoMunicipio)) {
    throw new Error("Código do município deve ter 7 dígitos (código IBGE).");
  }

  // Usa o certificado/ambiente da empresa, se der; senão o padrão do .env.
  let certificado: CertificadoA1;
  let ambiente: AmbienteNfse;
  try {
    if (!empresa) throw new Error("sem empresa");
    const ctx = obterContextoEmissao(empresa);
    certificado = ctx.certificado;
    ambiente = ctx.ambiente;
  } catch {
    certificado = obterCertificadoDoEnv();
    ambiente = ambientePadraoDoEnv();
  }

  const chaveCache = `${ambiente}:${codigoMunicipio}`;
  const emCache = cache.get(chaveCache);
  if (emCache && Date.now() - emCache.em < CACHE_MS) return emCache.resultado;

  const agente = criarAgenteHttpsComCertificado(certificado);
  const urls = [
    `${obterUrlBaseSefin(ambiente)}/parametros_municipais/${codigoMunicipio}/convenio`,
    `${obterUrlBaseAdn(ambiente)}/parametros_municipais/${codigoMunicipio}/convenio`,
  ];

  let ultimaResposta: { url: string; status: number; data: unknown } | null = null;
  for (const url of urls) {
    try {
      const r = await axios.get(url, {
        httpsAgent: agente,
        timeout: 20000,
        validateStatus: () => true,
      });
      ultimaResposta = { url, status: r.status, data: r.data };
      if (r.status >= 200 && r.status < 300) break;
      // 404 de rota inexistente: tenta o próximo host; 404 "município não
      // encontrado" também cai aqui, e é tratado abaixo.
    } catch (err: any) {
      ultimaResposta = { url, status: 0, data: { erroRede: err?.message } };
    }
  }

  let aderente: boolean | null = null;
  let resumo: string;

  if (ultimaResposta && ultimaResposta.status >= 200 && ultimaResposta.status < 300) {
    const campos = procurarCamposAdesao(ultimaResposta.data);
    const valores = campos.map((c) => valorVerdadeiro(c.valor)).filter((v) => v !== null);
    if (valores.length > 0) {
      aderente = valores.some((v) => v === true);
      resumo = aderente
        ? "O município consta como aderente ao Sistema Nacional da NFS-e."
        : "O município consta como NÃO aderente ao Sistema Nacional da NFS-e.";
      resumo += ` (campos: ${campos.map((c) => `${c.campo}=${String(c.valor)}`).join(", ")})`;
    } else {
      resumo =
        "O governo respondeu, mas não deu pra identificar com segurança o campo de adesão. Veja a resposta bruta.";
    }
  } else if (ultimaResposta && ultimaResposta.status === 404) {
    aderente = false;
    resumo =
      "O governo não encontrou parâmetros de convênio pra esse município — provavelmente ainda não aderiu (confira a resposta bruta).";
  } else {
    resumo = `Não foi possível consultar agora (HTTP ${ultimaResposta?.status ?? "sem resposta"}).`;
  }

  const resultado: ResultadoConvenio = {
    codigoMunicipio,
    ambiente,
    aderente,
    resumo,
    urlConsultada: ultimaResposta?.url ?? null,
    statusHttp: ultimaResposta?.status ?? null,
    respostaGoverno: ultimaResposta?.data ?? null,
    consultadoEm: new Date().toISOString(),
  };

  // Só guarda em cache respostas conclusivas.
  if (aderente !== null) cache.set(chaveCache, { em: Date.now(), resultado });
  return resultado;
}
