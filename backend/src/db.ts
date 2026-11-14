import { Pool } from "pg";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não definida. Copie .env.example para .env e ajuste os valores."
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  // Erros em clientes ociosos do pool não devem derrubar o processo,
  // mas precisam ser visíveis nos logs.
  console.error("Erro inesperado no pool do PostgreSQL:", err);
});
