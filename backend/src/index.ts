import express from "express";
import cors from "cors";
import "dotenv/config";
import { authRouter } from "./auth/auth.routes";
import { plantoesRouter } from "./plantoes/plantoes.routes";
import { tomadoresRouter } from "./tomadores/tomadores.routes";
import { nfseRouter } from "./nfse/nfse.routes";
import { empresasEmissorasRouter } from "./empresas-emissoras/empresas-emissoras.routes";

const app = express();

app.use(cors());
// Limite maior pra caber o certificado .pfx (em base64) no cadastro.
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/plantoes", plantoesRouter);
app.use("/tomadores", tomadoresRouter);
app.use("/nfse", nfseRouter);
app.use("/empresas-emissoras", empresasEmissorasRouter);

// Handler de erro genérico (evita expor stack trace ao cliente)
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).json({ erro: "Erro interno no servidor." });
  }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});
