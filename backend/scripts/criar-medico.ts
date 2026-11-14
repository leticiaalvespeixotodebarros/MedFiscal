/**
 * npm run criar-medico -- <email> "<nome completo>" <cpf>
 *
 * Cria o login de um médico no app (o app ainda não tem tela de
 * cadastro). A senha de acesso ao app é pedida no terminal, sem aparecer
 * na tela. Se o e-mail já existir, não altera nada.
 *
 * Exemplo:
 *   npm run criar-medico -- medico@exemplo.com "Nome do Médico" 00000000000
 */
import bcrypt from "bcryptjs";
import { pool } from "../src/db";
import { descreverErro, perguntar, soDigitos } from "./util-terminal";

async function main() {
  const args = process.argv.slice(2);
  const email = args[0];
  const cpf = soDigitos(args[args.length - 1] ?? "");
  // No Windows o npm tira as aspas: o nome pode chegar em vários pedaços.
  const nome = args.slice(1, -1).join(" ").trim();

  if (!email || !nome || cpf.length !== 11) {
    console.error('Uso: npm run criar-medico -- <email> "<nome completo>" <cpf com 11 dígitos>');
    process.exit(1);
  }

  const existente = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) OR cpf = $2`, [email, cpf]);
  if (existente.rows.length > 0) {
    console.log("✔ Já existe um médico com esse e-mail ou CPF — nada foi alterado.");
    await pool.end();
    return;
  }

  const senha = await perguntar("Senha de acesso ao app (mín. 6 caracteres): ", true);
  if (senha.length < 6) {
    console.error("Senha curta demais.");
    process.exit(1);
  }
  const confirmacao = await perguntar("Repita a senha: ", true);
  if (senha !== confirmacao) {
    console.error("As senhas não conferem.");
    process.exit(1);
  }

  await pool.query(
    `INSERT INTO users (nome, cpf, email, senha_hash) VALUES ($1, $2, $3, $4)`,
    [nome, cpf, email.toLowerCase(), await bcrypt.hash(senha, 10)]
  );
  console.log(`✔ Médico criado: ${nome} <${email}>. Já dá pra entrar no app com esse e-mail e a senha.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(`✘ Erro: ${descreverErro(err)}`);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
