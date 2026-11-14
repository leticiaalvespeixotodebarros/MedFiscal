import fs from "fs";
import https from "https";
import forge from "node-forge";
import "dotenv/config";

/**
 * Certificado digital A1 (.pfx) usado em duas coisas:
 * 1. Autenticação mTLS com os servidores do governo (Sefin/ADN).
 * 2. Assinatura digital (XMLDSig) da DPS e dos pedidos de evento.
 *
 * MULTI-TENANT (2026-10-24): cada empresa emissora pode ter o próprio
 * certificado guardado (cifrado) no banco — ver `certificadoEmpresa.ts`.
 * Todas as funções abaixo aceitam um `CertificadoA1` opcional; quando ele
 * não é passado, cai no certificado configurado no .env
 * (NFSE_CERTIFICADO_PATH + NFSE_CERTIFICADO_SENHA), que continua servindo
 * pras rotas de teste antigas.
 *
 * IMPORTANTE — segurança:
 * - O arquivo .pfx NUNCA deve ser commitado no Git nem colado em chat/IA.
 * - O caminho/senha do .env e a chave mestra (NFSE_CHAVE_MESTRA) só
 *   existem no .env local, que também nunca deve ir pro Git.
 */

export interface CertificadoA1 {
  pfx: Buffer;
  senha: string;
}

export type AmbienteNfse = "homologacao" | "producao";

function obterVariavelObrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(
      `Variável de ambiente ${nome} não configurada. Configure no arquivo .env do backend.`
    );
  }
  return valor;
}

/** Certificado padrão, configurado no .env (usado quando a empresa não tem um próprio). */
export function obterCertificadoDoEnv(): CertificadoA1 {
  const caminho = obterVariavelObrigatoria("NFSE_CERTIFICADO_PATH");
  const senha = obterVariavelObrigatoria("NFSE_CERTIFICADO_SENHA");

  if (!fs.existsSync(caminho)) {
    throw new Error(
      `Arquivo de certificado não encontrado em: ${caminho}. Confira o valor de NFSE_CERTIFICADO_PATH no .env.`
    );
  }

  return { pfx: fs.readFileSync(caminho), senha };
}

export function criarAgenteHttpsComCertificado(
  certificado: CertificadoA1 = obterCertificadoDoEnv()
): https.Agent {
  return new https.Agent({
    pfx: certificado.pfx,
    passphrase: certificado.senha,
    // Mantém a validação do certificado do servidor do governo ligada —
    // nunca desative isso, mesmo em homologação.
    rejectUnauthorized: true,
  });
}

export interface DadosCertificado {
  chavePrivadaPem: string;
  certificadoPem: string;
  /** Nome do titular (CN, sem o ":CNPJ" do final). */
  titular: string;
  /** CNPJ (14 dígitos) do titular, quando for um e-CNPJ. */
  cnpj: string | null;
  validoDe: Date;
  validoAte: Date;
}

/**
 * Abre o .pfx com node-forge (JavaScript puro — lê PKCS12 antigos sem
 * depender do OpenSSL nativo do Node) e devolve chave/certificado em PEM
 * + dados do titular. Lança erro claro se a senha estiver errada.
 */
export function lerCertificado(
  certificado: CertificadoA1 = obterCertificadoDoEnv()
): DadosCertificado {
  let pfx: forge.pkcs12.Pkcs12Pfx;
  try {
    const pfxBinario = forge.util.decode64(certificado.pfx.toString("base64"));
    const pfxAsn1 = forge.asn1.fromDer(pfxBinario);
    pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, certificado.senha);
  } catch {
    throw new Error(
      "Não foi possível abrir o certificado (.pfx). Confira se o arquivo é um certificado A1 válido e se a senha está correta."
    );
  }

  const sacoChave =
    pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ]?.[0] ??
    pfx.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];

  // Um .pfx pode trazer a cadeia inteira (certificado da AC junto) — o
  // certificado do titular é o que NÃO é autoridade certificadora.
  const certificados = (
    pfx.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  )
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  const certTitular =
    certificados.find((c) => {
      const bc = c.getExtension("basicConstraints") as any;
      return !bc?.cA;
    }) ?? certificados[0];

  if (!sacoChave?.key || !certTitular) {
    throw new Error(
      "Não foi possível extrair a chave privada ou o certificado do arquivo .pfx. Confira se a senha está correta."
    );
  }

  const cn = String(certTitular.subject.getField("CN")?.value ?? "");
  const matchCnpj = cn.match(/:(\d{14})\s*$/);

  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(sacoChave.key),
    certificadoPem: forge.pki.certificateToPem(certTitular),
    titular: matchCnpj ? cn.slice(0, cn.lastIndexOf(":")) : cn,
    cnpj: matchCnpj ? matchCnpj[1] : null,
    validoDe: certTitular.validity.notBefore,
    validoAte: certTitular.validity.notAfter,
  };
}

/** Mantido por compatibilidade com o código antigo. */
export function extrairChavesDoCertificado(certificado?: CertificadoA1): {
  chavePrivadaPem: string;
  certificadoPem: string;
} {
  const { chavePrivadaPem, certificadoPem } = lerCertificado(certificado);
  return { chavePrivadaPem, certificadoPem };
}

/**
 * Ambiente padrão do .env. Qualquer valor diferente de "producao" (inclusive
 * variável ausente ou digitada errado) vira homologação — o padrão seguro.
 */
export function ambientePadraoDoEnv(): AmbienteNfse {
  return process.env.NFSE_AMBIENTE === "producao" ? "producao" : "homologacao";
}

/** Retorna a URL base do ADN conforme o ambiente. */
export function obterUrlBaseAdn(ambiente: AmbienteNfse = ambientePadraoDoEnv()): string {
  return ambiente === "producao"
    ? "https://adn.nfse.gov.br"
    : "https://adn.producaorestrita.nfse.gov.br";
}

/** Retorna a URL base do SEFIN Nacional (emissão/eventos) conforme o ambiente. */
export function obterUrlBaseSefin(ambiente: AmbienteNfse = ambientePadraoDoEnv()): string {
  return ambiente === "producao"
    ? "https://sefin.nfse.gov.br/SefinNacional"
    : "https://sefin.producaorestrita.nfse.gov.br/SefinNacional";
}
