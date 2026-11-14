import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { pool } from "../db";

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

/**
 * POST /auth/login
 * Body: { email: string, senha: string }
 * Retorna um JWT usado nas demais rotas (Bearer token).
 *
 * Nota: o MVP real usa 2FA (SMS/app autenticador). Este protótipo
 * implementa apenas login/senha para validar o fluxo ponta a ponta.
 */
authRouter.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: "email e senha são obrigatórios." });
    }

    const result = await pool.query(
      "SELECT id, nome, senha_hash FROM users WHERE email = $1",
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      // Mensagem genérica de propósito: não revelar se o e-mail existe.
      return res.status(401).json({ erro: "Credenciais inválidas." });
    }

    const senhaValida = await bcrypt.compare(senha, user.senha_hash);

    if (!senhaValida) {
      return res.status(401).json({ erro: "Credenciais inválidas." });
    }

    const token = jwt.sign({ medicoId: user.id }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    } as jwt.SignOptions);

    return res.json({
      token,
      medico: { id: user.id, nome: user.nome },
    });
  } catch (err) {
    // Nunca deixar um erro inesperado (ex: banco fora do ar) derrubar o
    // processo inteiro — mesmo padrão já aplicado em plantoes.routes.ts.
    console.error("Erro ao fazer login:", err);
    return res.status(500).json({
      erro: "Não foi possível fazer login agora. Tente novamente em instantes.",
    });
  }
});
