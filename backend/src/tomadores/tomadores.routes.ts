import { Router, Response } from "express";
import axios from "axios";
import { pool } from "../db";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth.middleware";
import { iniciarImportacaoEmSegundoPlano, ultimaImportacao } from "./importacao";

export const tomadoresRouter = Router();

// Todas as rotas de tomadores exigem médico autenticado.
tomadoresRouter.use(authMiddleware);

/**
 * GET /tomadores
 * Lista os hospitais/tomadores já cadastrados pelo médico autenticado,
 * ordenados pelo apelido (ou razão social, se não houver apelido).
 */
tomadoresRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Mais usados/recentes primeiro: último plantão com o hospital ou a
    // nota mais recente emitida pra ele (importação), o que for mais novo.
    const result = await pool.query(
      `SELECT t.id, t.cnpj, t.razao_social, t.apelido, t.endereco, t.email, t.telefone,
              t.logradouro, t.numero, t.complemento, t.bairro, t.cep,
              t.codigo_municipio_ibge, t.municipio, t.uf, t.origem,
              t.ultima_nota_em, t.qtd_notas_importadas,
              COALESCE(u.qtd_plantoes, 0)::int AS qtd_plantoes,
              GREATEST(u.ultimo_plantao, t.ultima_nota_em) AS ultimo_uso,
              t.created_at
         FROM tomadores t
         LEFT JOIN (
           SELECT tomador_id, MAX(data) AS ultimo_plantao, COUNT(*) AS qtd_plantoes
             FROM plantoes
            WHERE medico_id = $1 AND tomador_id IS NOT NULL
            GROUP BY tomador_id
         ) u ON u.tomador_id = t.id
        WHERE t.medico_id = $1
        ORDER BY GREATEST(u.ultimo_plantao, t.ultima_nota_em) DESC NULLS LAST,
                 COALESCE(t.apelido, t.razao_social) ASC`,
      [req.medicoId]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Erro ao listar tomadores:", err);
    return res.status(500).json({
      erro: "Não foi possível carregar os hospitais cadastrados.",
    });
  }
});

/**
 * POST /tomadores
 * Body: { cnpj, razao_social, apelido?, endereco?, email?, telefone? }
 *
 * Cadastra (ou atualiza, se o CNPJ já existir para esse médico) um
 * hospital/tomador de nota fiscal. O apelido é opcional — se não for
 * informado, o app usa a razão social para exibição.
 */
tomadoresRouter.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      cnpj,
      razao_social,
      apelido,
      endereco,
      email,
      telefone,
      logradouro,
      numero,
      complemento,
      bairro,
      cep,
      codigo_municipio_ibge,
    } = req.body;

    if (!cnpj || !razao_social) {
      return res.status(400).json({
        erro: "Campos obrigatórios: cnpj, razao_social.",
      });
    }

    const cnpjLimpo = String(cnpj).replace(/\D/g, "");
    if (cnpjLimpo.length !== 14) {
      return res.status(400).json({ erro: "CNPJ inválido. Deve ter 14 dígitos." });
    }

    const result = await pool.query(
      `INSERT INTO tomadores (
         medico_id, cnpj, razao_social, apelido, endereco, email, telefone,
         logradouro, numero, complemento, bairro, cep, codigo_municipio_ibge
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (medico_id, cnpj) DO UPDATE
         SET razao_social = EXCLUDED.razao_social,
             apelido = EXCLUDED.apelido,
             endereco = EXCLUDED.endereco,
             email = EXCLUDED.email,
             telefone = EXCLUDED.telefone,
             logradouro = EXCLUDED.logradouro,
             numero = EXCLUDED.numero,
             complemento = EXCLUDED.complemento,
             bairro = EXCLUDED.bairro,
             cep = EXCLUDED.cep,
             codigo_municipio_ibge = EXCLUDED.codigo_municipio_ibge
       RETURNING id, cnpj, razao_social, apelido, endereco, email, telefone,
                 logradouro, numero, complemento, bairro, cep,
                 codigo_municipio_ibge, created_at`,
      [
        req.medicoId,
        cnpjLimpo,
        razao_social,
        apelido || null,
        endereco ?? null,
        email ?? null,
        telefone ?? null,
        logradouro ?? null,
        numero ?? null,
        complemento ?? null,
        bairro ?? null,
        cep ?? null,
        codigo_municipio_ibge ?? null,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao cadastrar tomador:", err);
    return res.status(500).json({ erro: "Não foi possível cadastrar o hospital." });
  }
});

/**
 * GET /tomadores/cnpj/:cnpj
 * Consulta dados públicos do CNPJ na BrasilAPI para autopreenchimento
 * (razão social, endereço, e-mail e telefone, quando disponíveis).
 * Não salva nada — só devolve os dados pro app preencher o formulário.
 */
tomadoresRouter.get(
  "/cnpj/:cnpj",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const cnpjLimpo = req.params.cnpj.replace(/\D/g, "");
      if (cnpjLimpo.length !== 14) {
        return res.status(400).json({ erro: "CNPJ deve ter 14 dígitos." });
      }

      const resposta = await axios.get(
        `https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`,
        { timeout: 8000 }
      );

      const dados = resposta.data;
      const endereco = [
        dados.logradouro,
        dados.numero,
        dados.bairro,
        dados.municipio,
        dados.uf,
        dados.cep,
      ]
        .filter(Boolean)
        .join(", ");

      // Busca o código IBGE do município via ViaCEP, usando o CEP que a
      // BrasilAPI já devolveu — necessário pra emitir NFS-e de verdade
      // depois (a DPS exige o código de 7 dígitos, não o nome da cidade).
      // Feito silenciosamente aqui, sem precisar perguntar isso pra
      // usuária — se falhar, o cadastro continua funcionando normal,
      // só sem esse dado (a emissão automática avisa claramente se
      // faltar quando for a hora de usar).
      let codigoMunicipioIbge: string | null = null;
      const cepLimpo = String(dados.cep ?? "").replace(/\D/g, "");
      if (cepLimpo.length === 8) {
        try {
          const respostaViaCep = await axios.get(
            `https://viacep.com.br/ws/${cepLimpo}/json/`,
            { timeout: 5000 }
          );
          if (!respostaViaCep.data?.erro && respostaViaCep.data?.ibge) {
            codigoMunicipioIbge = String(respostaViaCep.data.ibge);
          }
        } catch (erroViaCep) {
          console.error(
            "Não foi possível buscar o código IBGE via ViaCEP:",
            erroViaCep
          );
        }
      }

      return res.json({
        razao_social: dados.razao_social ?? dados.nome_fantasia ?? "",
        endereco,
        email: dados.email ?? "",
        telefone: dados.ddd_telefone_1 ?? "",
        logradouro: dados.logradouro ?? "",
        numero: dados.numero ?? "",
        complemento: dados.complemento ?? "",
        bairro: dados.bairro ?? "",
        cep: cepLimpo,
        codigo_municipio_ibge: codigoMunicipioIbge,
      });
    } catch (err: any) {
      if (err.response?.status === 404) {
        return res.status(404).json({ erro: "CNPJ não encontrado." });
      }
      console.error("Erro ao consultar CNPJ:", err);
      return res.status(502).json({
        erro: "Não foi possível consultar esse CNPJ agora. Preencha os dados manualmente.",
      });
    }
  }
);

/**
 * POST /tomadores/importar
 * Dispara a importação automática dos hospitais a partir das NFS-e que a
 * empresa do médico já emitiu (últimos 24 meses ou desde a abertura).
 * Roda em segundo plano — acompanhe em GET /tomadores/importar/status.
 */
tomadoresRouter.post("/importar", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const empresa = await pool.query(
      `SELECT id FROM empresas_emissoras WHERE medico_id = $1`,
      [req.medicoId]
    );
    if (empresa.rows.length === 0) {
      return res.status(400).json({
        erro: "Cadastre os dados da sua empresa (tela Minha Empresa) antes de importar os hospitais.",
      });
    }
    const importacao = await iniciarImportacaoEmSegundoPlano(req.medicoId!, "manual");
    return res.status(202).json(importacao);
  } catch (err) {
    console.error("Erro ao iniciar importação de hospitais:", err);
    return res.status(500).json({ erro: "Não foi possível iniciar a importação agora." });
  }
});

/** GET /tomadores/importar/status — última importação do médico (ou null). */
tomadoresRouter.get("/importar/status", async (req: AuthenticatedRequest, res: Response) => {
  try {
    return res.json(await ultimaImportacao(req.medicoId!));
  } catch (err) {
    console.error("Erro ao consultar importação de hospitais:", err);
    return res.status(500).json({ erro: "Não foi possível consultar a importação." });
  }
});
