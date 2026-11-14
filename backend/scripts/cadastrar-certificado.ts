/**
 * npm run cadastrar-certificado -- <email do médico> "<caminho do .pfx>" "<senha>"
 *
 * Cadastra o certificado A1 de uma empresa emissora direto do PC (sem
 * precisar mandar o .pfx pelo celular). Faz as mesmas conferências da
 * rota POST /empresas-emissoras/me/certificado: senha certa, mesmo CNPJ
 * da empresa, dentro da validade. Guarda cifrado (NFSE_CHAVE_MESTRA).
 *
 * Exemplo:
 *   npm run cadastrar-certificado -- medico@exemplo.com "C:\caminho\certificado.pfx"
 *
 * Depois de cadastrar, já importa os hospitais das notas que a empresa
 * emitiu (últimos 24 meses). Pra pular: acrescente --sem-importar.
 */
import fs from "fs";
import { pool } from "../src/db";
import { lerCertificado } from "../src/nfse/certificado";
import { cifrar } from "../src/nfse/certificadoEmpresa";
import { importarTomadoresDasNotas } from "../src/tomadores/importacao";
import { perguntar } from "./util-terminal";

async function main() {
  const args = process.argv.slice(2);
  const semImportar = args.includes("--sem-importar");
  const resto = args.filter((a) => a !== "--sem-importar");
  const email = resto[0];
  const pedacos = resto.slice(1);

  // No Windows o npm tira as aspas, então um caminho com espaços chega
  // quebrado em vários pedaços. Remonta o caminho; se o último pedaço
  // for a senha (uso antigo), separa.
  let caminhoPfx: string | undefined;
  let senha: string | undefined;
  if (pedacos.length > 0) {
    const inteiro = pedacos.join(" ");
    if (fs.existsSync(inteiro)) {
      caminhoPfx = inteiro; // senha será pedida na tela
    } else if (pedacos.length >= 2) {
      senha = pedacos[pedacos.length - 1];
      caminhoPfx = pedacos.slice(0, -1).join(" ");
    } else {
      caminhoPfx = inteiro;
    }
  } else {
    // Sem caminho: usa o certificado (e a senha) configurados no .env.
    caminhoPfx = process.env.NFSE_CERTIFICADO_PATH;
    senha = process.env.NFSE_CERTIFICADO_SENHA;
  }

  if (!email || !caminhoPfx) {
    console.error(
      'Uso: npm run cadastrar-certificado -- <email do médico> "<caminho do .pfx>"\n' +
        "     (a senha é pedida na tela, sem aparecer; sem o caminho, usa o certificado do .env)"
    );
    process.exit(1);
  }
  if (!fs.existsSync(caminhoPfx)) {
    console.error(`Arquivo não encontrado: ${caminhoPfx}`);
    process.exit(1);
  }
  if (!senha) {
    senha = await perguntar("Senha do certificado (não aparece na tela): ", true);
    if (!senha) {
      console.error("Sem senha, não dá pra abrir o certificado.");
      process.exit(1);
    }
  }
  console.log(`Certificado: ${caminhoPfx}`);
  if (!fs.existsSync(caminhoPfx)) {
    console.error(`Arquivo não encontrado: ${caminhoPfx}`);
    process.exit(1);
  }

  console.log("1/4 Lendo o certificado...");
  const pfx = fs.readFileSync(caminhoPfx);
  const dados = lerCertificado({ pfx, senha });
  console.log(`    titular: ${dados.titular} · CNPJ ${dados.cnpj ?? "?"} · válido até ${dados.validoAte.toLocaleDateString("pt-BR")}`);

  console.log("2/4 Procurando a empresa emissora no banco...");
  const r = await pool.query(
    `SELECT e.id, e.cnpj, e.razao_social, e.medico_id
       FROM empresas_emissoras e
       JOIN users u ON u.id = e.medico_id
      WHERE lower(u.email) = lower($1)`,
    [email]
  );
  if (r.rows.length === 0) {
    console.error(
      `Nenhuma empresa emissora cadastrada para ${email}. Cadastre os dados da empresa primeiro (tela "Minha empresa" no app).`
    );
    process.exit(1);
  }
  const empresa = r.rows[0];

  if (dados.cnpj && dados.cnpj !== empresa.cnpj) {
    console.error(
      `Esse certificado é do CNPJ ${dados.cnpj}, mas a empresa de ${email} é ${empresa.cnpj} (${empresa.razao_social}).`
    );
    process.exit(1);
  }
  if (dados.validoAte.getTime() < Date.now()) {
    console.error(`Esse certificado venceu em ${dados.validoAte.toLocaleDateString("pt-BR")}.`);
    process.exit(1);
  }

  console.log(`    empresa: ${empresa.razao_social} (${empresa.cnpj})`);

  console.log("3/4 Guardando o certificado (cifrado)...");
  await pool.query(
    `UPDATE empresas_emissoras
        SET certificado_pfx_cifrado = $1, certificado_senha_cifrada = $2,
            certificado_titular = $3, certificado_validade = $4, updated_at = now()
      WHERE id = $5`,
    [cifrar(pfx), cifrar(Buffer.from(senha, "utf-8")), dados.titular, dados.validoAte, empresa.id]
  );

  console.log(
    `✔ Certificado de ${dados.titular} cadastrado para ${empresa.razao_social} (válido até ${dados.validoAte.toLocaleDateString("pt-BR")}).`
  );

  if (!semImportar) {
    console.log("4/4 Importando os hospitais das notas emitidas (pode levar alguns minutos)...");
    const resumo = await importarTomadoresDasNotas(empresa.medico_id, (p) => {
      process.stdout.write(`\r  lidos ${p.documentosLidos} documento(s) — NSU ${p.nsu}   `);
    });
    process.stdout.write("\n");
    console.log(`✔ ${resumo.mensagem}`);
    console.log(
      `  Período: desde ${resumo.periodoInicio} · notas emitidas no período: ${resumo.notasEmitidasPeriodo} · canceladas: ${resumo.notasCanceladas} · ignoradas (pessoa física/exterior): ${resumo.ignoradosPessoaFisica}`
    );
  }
  await pool.end();
}

/** Mostra o erro de um jeito útil — alguns erros de conexão (ex: banco
 * fora do ar) vêm com a mensagem vazia e só o código preenchido. */
function descreverErro(err: any): string {
  const partes = [err?.message, err?.code && `código ${err.code}`].filter(Boolean);
  if (Array.isArray(err?.errors)) {
    for (const e of err.errors) partes.push(`${e?.code ?? ""} ${e?.message ?? ""}`.trim());
  }
  if (partes.length === 0) partes.push(String(err));
  if (err?.code === "ECONNREFUSED" || (Array.isArray(err?.errors) && err.errors.some((e: any) => e?.code === "ECONNREFUSED"))) {
    partes.push("→ o banco não respondeu: confira se o Docker Desktop está aberto e rode `docker compose up -d`.");
  }
  return partes.join(" | ");
}

main()
  .then(() => {
    process.exitCode = process.exitCode ?? 0;
  })
  .catch(async (err) => {
    console.error(`✘ Erro: ${descreverErro(err)}`);
    await pool.end().catch(() => undefined);
    process.exitCode = 1;
  });
