/**
 * backend/src/nfse/envio.ts
 *
 * Envia a DPS assinada pro Sefin Nacional, no formato exigido:
 * XML compactado em GZip, codificado em Base64, dentro de um JSON com o
 * campo "dpsXmlGZipB64" (confirmado no Swagger oficial da API).
 *
 * A resposta de sucesso traz o campo "nfseXmlGZipB64" — a NFS-e emitida,
 * no mesmo formato (GZip + Base64) — que aqui já devolvemos decodificado
 * de volta pra XML legível, pra facilitar conferir o resultado.
 */

import axios from "axios";
import zlib from "zlib";
import {
  AmbienteNfse,
  CertificadoA1,
  criarAgenteHttpsComCertificado,
  obterUrlBaseSefin,
} from "./certificado";

export interface ResultadoEnvioDps {
  status: number;
  corpoResposta: any;
  /** XML da NFS-e já decodificado, se a emissão deu certo. */
  nfseXmlDecodificado: string | null;
}

export interface OpcoesEnvio {
  /** Certificado da empresa emissora (padrão: o do .env). */
  certificado?: CertificadoA1;
  /** Ambiente de destino (padrão: NFSE_AMBIENTE do .env). Precisa bater
   * com o tpAmb do XML, senão o governo rejeita. */
  ambiente?: AmbienteNfse;
}

export async function enviarDpsParaSefin(
  xmlAssinado: string,
  opcoes: OpcoesEnvio = {}
): Promise<ResultadoEnvioDps> {
  const agente = criarAgenteHttpsComCertificado(opcoes.certificado);
  const urlBase = obterUrlBaseSefin(opcoes.ambiente);

  const xmlGzip = zlib.gzipSync(Buffer.from(xmlAssinado, "utf-8"));
  const xmlGzipBase64 = xmlGzip.toString("base64");

  const resposta = await axios.post(
    `${urlBase}/nfse`,
    { dpsXmlGZipB64: xmlGzipBase64 },
    {
      httpsAgent: agente,
      timeout: 30000,
      headers: { "Content-Type": "application/json" },
      // Queremos ver a resposta mesmo se não for 2xx (erro de validação
      // do governo, por exemplo), em vez do axios jogar uma exception.
      validateStatus: () => true,
    }
  );

  let nfseXmlDecodificado: string | null = null;
  if (resposta.data?.nfseXmlGZipB64) {
    try {
      const bufferGzip = Buffer.from(resposta.data.nfseXmlGZipB64, "base64");
      nfseXmlDecodificado = zlib.gunzipSync(bufferGzip).toString("utf-8");
    } catch {
      nfseXmlDecodificado = null;
    }
  }

  return {
    status: resposta.status,
    corpoResposta: resposta.data,
    nfseXmlDecodificado,
  };
}
