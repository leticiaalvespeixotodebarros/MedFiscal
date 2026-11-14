/**
 * backend/src/nfse/certificadoEmpresa.ts
 *
 * Certificado A1 POR EMPRESA EMISSORA (multi-tenant de verdade).
 *
 * O .pfx e a senha de cada empresa ficam no banco CIFRADOS com
 * AES-256-GCM, usando uma chave mestra que só existe no .env
 * (NFSE_CHAVE_MESTRA). Quem tiver acesso só ao banco não consegue usar
 * o certificado de ninguém.
 *
 * Também concentra as travas de segurança antes de falar com o governo:
 * - o certificado precisa pertencer ao mesmo CNPJ da empresa emissora;
 * - o certificado não pode estar vencido;
 * - Produção só é permitida com NFSE_PERMITIR_PRODUCAO=true no .env.
 */

import crypto from "crypto";
import {
  AmbienteNfse,
  CertificadoA1,
  DadosCertificado,
  lerCertificado,
  obterCertificadoDoEnv,
} from "./certificado";
import { ErroEmissaoNfse } from "./erros";

function obterChaveMestra(): Buffer {
  const valor = process.env.NFSE_CHAVE_MESTRA;
  if (!valor || valor.length < 32) {
    throw new ErroEmissaoNfse(
      "NFSE_CHAVE_MESTRA não configurada no .env do backend (precisa de pelo menos 32 caracteres). Ela é usada pra cifrar os certificados guardados no banco."
    );
  }
  // Deriva sempre 32 bytes, qualquer que seja o formato digitado.
  return crypto.createHash("sha256").update(valor, "utf-8").digest();
}

/** Cifra (AES-256-GCM) e devolve "iv:tag:conteudo" em base64. */
export function cifrar(dados: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", obterChaveMestra(), iv);
  const conteudo = Buffer.concat([cipher.update(dados), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, conteudo].map((b) => b.toString("base64")).join(":");
}

export function decifrar(texto: string): Buffer {
  const [iv, tag, conteudo] = texto.split(":").map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", obterChaveMestra(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(conteudo), decipher.final()]);
}

/** Linha da tabela empresas_emissoras (só os campos usados aqui). */
export interface EmpresaComCertificado {
  cnpj: string;
  ambiente: string;
  certificado_pfx_cifrado?: string | null;
  certificado_senha_cifrada?: string | null;
}

export interface ContextoEmissao {
  certificado: CertificadoA1;
  dadosCertificado: DadosCertificado;
  ambiente: AmbienteNfse;
  /** "empresa" = certificado próprio da empresa; "env" = certificado padrão do .env. */
  origemCertificado: "empresa" | "env";
}

export interface CertificadoDaEmpresa {
  certificado: CertificadoA1;
  dadosCertificado: DadosCertificado;
  /** "empresa" = certificado próprio da empresa; "env" = certificado padrão do .env. */
  origemCertificado: "empresa" | "env";
}

/**
 * Certificado da empresa (o próprio, se cadastrado; senão o padrão do
 * .env), já conferido: precisa ser do MESMO CNPJ e não pode estar vencido.
 * Não olha ambiente — serve tanto pra emitir quanto pra só CONSULTAR
 * (ex: importar hospitais das notas já emitidas).
 */
export function obterCertificadoDaEmpresa(
  empresa: EmpresaComCertificado
): CertificadoDaEmpresa {
  let certificado: CertificadoA1;
  let origemCertificado: "empresa" | "env";
  if (empresa.certificado_pfx_cifrado && empresa.certificado_senha_cifrada) {
    certificado = {
      pfx: decifrar(empresa.certificado_pfx_cifrado),
      senha: decifrar(empresa.certificado_senha_cifrada).toString("utf-8"),
    };
    origemCertificado = "empresa";
  } else {
    try {
      certificado = obterCertificadoDoEnv();
    } catch {
      throw new ErroEmissaoNfse(
        "Essa empresa ainda não tem certificado digital cadastrado. Cadastre o certificado A1 (.pfx) dela."
      );
    }
    origemCertificado = "env";
  }

  let dadosCertificado: DadosCertificado;
  try {
    dadosCertificado = lerCertificado(certificado);
  } catch (err: any) {
    throw new ErroEmissaoNfse(err?.message ?? "Certificado inválido.");
  }

  if (dadosCertificado.cnpj && dadosCertificado.cnpj !== empresa.cnpj) {
    throw new ErroEmissaoNfse(
      origemCertificado === "env"
        ? `Essa empresa ainda não tem certificado próprio cadastrado, e o certificado padrão do servidor é de outro CNPJ (${dadosCertificado.cnpj}). Cadastre o certificado A1 (.pfx) da empresa ${empresa.cnpj}.`
        : `O certificado cadastrado é do CNPJ ${dadosCertificado.cnpj}, mas a empresa emissora é ${empresa.cnpj}. Cadastre o certificado certo.`
    );
  }

  if (dadosCertificado.validoAte.getTime() < Date.now()) {
    throw new ErroEmissaoNfse(
      `O certificado digital (${dadosCertificado.titular}) venceu em ${dadosCertificado.validoAte.toLocaleDateString("pt-BR")}. Renove o certificado e cadastre o novo.`
    );
  }

  return { certificado, dadosCertificado, origemCertificado };
}

/**
 * Monta o que é preciso pra falar com o governo em nome da empresa:
 * certificado certo + ambiente certo, já validados.
 */
export function obterContextoEmissao(empresa: EmpresaComCertificado): ContextoEmissao {
  const ambiente: AmbienteNfse =
    empresa.ambiente === "producao" ? "producao" : "homologacao";

  if (ambiente === "producao" && process.env.NFSE_PERMITIR_PRODUCAO !== "true") {
    throw new ErroEmissaoNfse(
      "Essa empresa está configurada para PRODUÇÃO (nota com validade fiscal), mas o servidor não está liberado pra isso. Para emitir de verdade, coloque NFSE_PERMITIR_PRODUCAO=true no .env do backend e reinicie."
    );
  }

  return { ...obterCertificadoDaEmpresa(empresa), ambiente };
}
