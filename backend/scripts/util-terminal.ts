/**
 * Perguntas no terminal para os scripts. Com `oculto = true` a digitação
 * não aparece na tela (senhas) — assim a senha não fica no histórico do
 * terminal, no .env nem em nenhuma conversa.
 */
import readline from "readline";

export function perguntar(texto: string, oculto = false): Promise<string> {
  return new Promise((resolve) => {
    const tty = !!process.stdin.isTTY;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: tty,
    });
    if (oculto && tty) {
      let promptEscrito = false;
      (rl as any)._writeToOutput = (s: string) => {
        if (!promptEscrito) {
          process.stdout.write(s); // só o texto da pergunta
          promptEscrito = true;
        } else if (/[\r\n]/.test(s)) {
          process.stdout.write("\n");
        }
      };
    }
    rl.question(texto, (resposta) => {
      rl.close();
      resolve(resposta.trim());
    });
  });
}

export function soDigitos(t: string): string {
  return t.replace(/\D/g, "");
}

/** Descreve erros de conexão (que às vezes chegam sem mensagem). */
export function descreverErro(err: any): string {
  const partes = [err?.message, err?.code && `código ${err.code}`].filter(Boolean);
  if (Array.isArray(err?.errors)) {
    for (const e of err.errors) partes.push(`${e?.code ?? ""} ${e?.message ?? ""}`.trim());
  }
  const refused =
    err?.code === "ECONNREFUSED" ||
    (Array.isArray(err?.errors) && err.errors.some((e: any) => e?.code === "ECONNREFUSED"));
  if (refused) {
    partes.push("→ o banco não respondeu: abra o Docker Desktop e rode `docker compose up -d`.");
  }
  return partes.join(" | ") || String(err);
}
