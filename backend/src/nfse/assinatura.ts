/**
 * backend/src/nfse/assinatura.ts
 *
 * Assina digitalmente o XML da DPS, no padrão XMLDSig exigido pelo
 * Emissor Nacional. Os algoritmos usados aqui (C14N, RSA-SHA1, SHA1)
 * foram confirmados observando a assinatura de uma NFS-e REAL emitida
 * em setembro/2026 (o próprio governo assina as notas que
 * devolve exatamente assim) — não são uma escolha nossa, é o que o
 * padrão exige.
 */

import { SignedXml } from "xml-crypto";
import { CertificadoA1, extrairChavesDoCertificado } from "./certificado";

/**
 * Assina um elemento do XML (identificado pelo atributo Id) e coloca a
 * <Signature> logo depois dele, dentro do mesmo pai (assinatura
 * "envelope", igual ao padrão observado na NFS-e real).
 *
 * Usado tanto pra DPS (elemento infDPS) quanto pro pedido de registro de
 * evento, ex: cancelamento (elemento infPedReg).
 */
export function assinarElementoXml(
  xml: string,
  idElemento: string,
  nomeElemento: string,
  certificado?: CertificadoA1
): string {
  const { chavePrivadaPem, certificadoPem } =
    extrairChavesDoCertificado(certificado);

  // Nas versões mais novas do xml-crypto, a chave privada e o
  // certificado são passados direto na criação do objeto (não mais
  // como propriedades atribuídas depois).
  const sig = new SignedXml({
    privateKey: chavePrivadaPem,
    publicCert: certificadoPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  } as any);

  sig.addReference({
    xpath: `//*[@Id='${idElemento}']`,
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });

  sig.computeSignature(xml, {
    location: {
      reference: `//*[local-name(.)='${nomeElemento}']`,
      action: "after",
    },
  });

  return sig.getSignedXml();
}

/**
 * Assina o XML da DPS. `idElemento` é o valor do atributo Id do
 * <infDPS> (ex: "DPS<IBGE><tipoInsc><CNPJ><serie><nDPS>").
 */
export function assinarXmlDps(
  xmlDps: string,
  idElemento: string,
  certificado?: CertificadoA1
): string {
  return assinarElementoXml(xmlDps, idElemento, "infDPS", certificado);
}
