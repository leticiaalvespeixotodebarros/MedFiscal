/**
 * npm run importar-hospitais -- <email do médico>
 *
 * Importa (ou continua importando) os hospitais a partir das NFS-e que a
 * empresa do médico emitiu nos últimos 24 meses (ou desde a abertura do
 * CNPJ). Mesmo processo do botão "Importar hospitais das notas" no app.
 */
import { pool } from "../src/db";
import { importarTomadoresDasNotas } from "../src/tomadores/importacao";

async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error("Uso: npm run importar-hospitais -- <email do médico>");
    process.exit(1);
  }
  const r = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]);
  if (r.rows.length === 0) {
    console.error(`Médico não encontrado: ${email}`);
    process.exit(1);
  }
  console.log("Lendo as notas emitidas no ADN...");
  const resumo = await importarTomadoresDasNotas(r.rows[0].id, (p) => {
    process.stdout.write(`\r  lidos ${p.documentosLidos} documento(s) — NSU ${p.nsu}   `);
  });
  process.stdout.write("\n");
  console.log(`✔ ${resumo.mensagem}`);
  console.log(
    `  Período: desde ${resumo.periodoInicio} · notas emitidas no período: ${resumo.notasEmitidasPeriodo} · canceladas: ${resumo.notasCanceladas} · ignoradas (pessoa física/exterior): ${resumo.ignoradosPessoaFisica}`
  );
  await pool.end();
}

main().catch(async (err) => {
  const partes = [err?.message, err?.code && `código ${err.code}`].filter(Boolean);
  if (Array.isArray(err?.errors)) for (const e of err.errors) partes.push(`${e?.code ?? ""} ${e?.message ?? ""}`.trim());
  console.error(`✘ Erro: ${partes.join(" | ") || String(err)}`);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
