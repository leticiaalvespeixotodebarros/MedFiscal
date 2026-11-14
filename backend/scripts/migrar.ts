/**
 * npm run migrar
 *
 * Roda TODAS as migrações do banco, na ordem certa. Todas são
 * idempotentes (CREATE/ALTER ... IF NOT EXISTS), então pode rodar
 * quantas vezes quiser — o que já existe é ignorado. Substitui rodar os
 * migration_*.sql um a um pelo docker exec.
 */
import fs from "fs";
import path from "path";
import { pool } from "../src/db";

const ORDEM = [
  "migration_historico.sql",
  "migration_tomadores.sql",
  "migration_valor_opcional.sql",
  "migration_apelido_tomador.sql",
  "migration_nao_realizado.sql",
  "migration_nfse_numeracao.sql",
  "migration_empresas_emissoras.sql",
  "migration_nfse_emissoes.sql",
  "migration_simples_nacional_calculo.sql",
  "migration_endereco_estruturado_tomador.sql",
  "migration_certificado_empresa.sql",
  "migration_importacao_tomadores.sql",
];

async function main() {
  const pasta = path.resolve(__dirname, "..");
  const encontrados = fs.readdirSync(pasta).filter((f) => /^migration_.*\.sql$/.test(f));
  const foraDaLista = encontrados.filter((f) => !ORDEM.includes(f));
  if (foraDaLista.length > 0) {
    console.warn(
      `Atenção: migrações fora da lista de ordem (não serão rodadas): ${foraDaLista.join(", ")}`
    );
  }

  for (const arquivo of ORDEM) {
    const caminho = path.join(pasta, arquivo);
    if (!fs.existsSync(caminho)) {
      console.warn(`- ${arquivo}: arquivo não encontrado, pulando`);
      continue;
    }
    const sql = fs.readFileSync(caminho, "utf-8");
    try {
      await pool.query(sql);
      console.log(`✔ ${arquivo}`);
    } catch (err: any) {
      const codigos = Array.isArray(err?.errors) ? err.errors.map((e: any) => e?.code) : [err?.code];
      const semBanco = codigos.includes("ECONNREFUSED");
      console.error(
        `✘ ${arquivo}: ${err?.message || codigos.filter(Boolean).join(", ") || String(err)}` +
          (semBanco
            ? "\n  → o banco não respondeu: abra o Docker Desktop, espere iniciar e rode `docker compose up -d`."
            : "")
      );
      process.exitCode = 1;
      break;
    }
  }
  await pool.end();
}

main();
