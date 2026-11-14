import { Router, Response } from "express";
import { pool } from "../db";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth.middleware";
import { calcularPercentualSimplesNacional } from "../nfse/simples-nacional";
import { lerCertificado } from "../nfse/certificado";
import { cifrar } from "../nfse/certificadoEmpresa";
import { consultarConvenioMunicipio } from "../nfse/convenio";
import { iniciarImportacaoEmSegundoPlano } from "../tomadores/importacao";

export const empresasEmissorasRouter = Router();

empresasEmissorasRouter.use(authMiddleware);

const COLUNAS = `
  id, medico_id, cnpj, razao_social, inscricao_municipal,
  codigo_municipio_ibge, cep, logradouro, numero, complemento, bairro,
  telefone, email, op_simp_nac, reg_ap_trib_sn,
  percentual_aprox_tributos_sn, codigo_trib_nac, codigo_nbs, ambiente,
  certificado_titular, certificado_validade,
  (certificado_pfx_cifrado IS NOT NULL) AS certificado_cadastrado,
  created_at, updated_at
`;

/**
 * GET /empresas-emissoras/me
 * Devolve os dados fiscais da empresa emissora do médico autenticado
 * (ou 404 se ele ainda não cadastrou nenhuma).
 */
empresasEmissorasRouter.get(
  "/me",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT ${COLUNAS} FROM empresas_emissoras WHERE medico_id = $1`,
        [req.medicoId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          erro: "Nenhuma empresa emissora cadastrada para este médico ainda.",
        });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error("Erro ao buscar empresa emissora:", err);
      return res.status(500).json({
        erro: "Não foi possível carregar os dados da empresa emissora.",
      });
    }
  }
);

/**
 * POST /empresas-emissoras/me
 * Cria (ou substitui, se já existir) os dados fiscais da empresa
 * emissora do médico autenticado. Um médico = uma empresa emissora
 * (por enquanto — pode virar 1:N no futuro se algum médico faturar por
 * mais de uma empresa).
 */
empresasEmissorasRouter.post(
  "/me",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        cnpj,
        razao_social,
        inscricao_municipal,
        codigo_municipio_ibge,
        cep,
        logradouro,
        numero,
        complemento,
        bairro,
        telefone,
        email,
        op_simp_nac,
        reg_ap_trib_sn,
        percentual_aprox_tributos_sn,
        codigo_trib_nac,
        codigo_nbs,
        ambiente,
      } = req.body;

      const camposObrigatorios = {
        cnpj,
        razao_social,
        codigo_municipio_ibge,
        cep,
        logradouro,
        numero,
        bairro,
        codigo_trib_nac,
      };
      const faltando = Object.entries(camposObrigatorios)
        .filter(([, valor]) => !valor)
        .map(([nome]) => nome);

      if (faltando.length > 0) {
        return res.status(400).json({
          erro: `Campos obrigatórios faltando: ${faltando.join(", ")}.`,
        });
      }

      const result = await pool.query(
        `INSERT INTO empresas_emissoras (
           medico_id, cnpj, razao_social, inscricao_municipal,
           codigo_municipio_ibge, cep, logradouro, numero, complemento,
           bairro, telefone, email, op_simp_nac, reg_ap_trib_sn,
           percentual_aprox_tributos_sn, codigo_trib_nac, codigo_nbs, ambiente
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (medico_id) DO UPDATE SET
           cnpj = EXCLUDED.cnpj,
           razao_social = EXCLUDED.razao_social,
           inscricao_municipal = EXCLUDED.inscricao_municipal,
           codigo_municipio_ibge = EXCLUDED.codigo_municipio_ibge,
           cep = EXCLUDED.cep,
           logradouro = EXCLUDED.logradouro,
           numero = EXCLUDED.numero,
           complemento = EXCLUDED.complemento,
           bairro = EXCLUDED.bairro,
           telefone = EXCLUDED.telefone,
           email = EXCLUDED.email,
           op_simp_nac = EXCLUDED.op_simp_nac,
           reg_ap_trib_sn = EXCLUDED.reg_ap_trib_sn,
           percentual_aprox_tributos_sn = EXCLUDED.percentual_aprox_tributos_sn,
           codigo_trib_nac = EXCLUDED.codigo_trib_nac,
           codigo_nbs = EXCLUDED.codigo_nbs,
           ambiente = EXCLUDED.ambiente,
           updated_at = now()
         RETURNING ${COLUNAS}`,
        [
          req.medicoId,
          cnpj,
          razao_social,
          inscricao_municipal ?? null,
          codigo_municipio_ibge,
          cep,
          logradouro,
          numero,
          complemento ?? null,
          bairro,
          telefone ?? null,
          email ?? null,
          op_simp_nac ?? 3,
          reg_ap_trib_sn ?? 1,
          percentual_aprox_tributos_sn ?? 0,
          codigo_trib_nac,
          codigo_nbs ?? null,
          ambiente ?? "homologacao",
        ]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Erro ao salvar empresa emissora:", err);
      return res.status(500).json({
        erro: "Não foi possível salvar os dados da empresa emissora.",
      });
    }
  }
);

/**
 * Helper: busca a empresa emissora do médico autenticado, ou devolve
 * null (usado pelas rotas abaixo, que precisam sempre partir dela).
 */
async function buscarEmpresaDoMedico(medicoId: string) {
  const result = await pool.query(
    `SELECT id FROM empresas_emissoras WHERE medico_id = $1`,
    [medicoId]
  );
  return result.rows[0] ?? null;
}

/**
 * GET /empresas-emissoras/me/simples-nacional
 * Mostra o cálculo atual da alíquota efetiva do Simples Nacional da
 * empresa emissora do médico autenticado — útil pra conferir se o
 * cálculo automático está batendo com o esperado antes de emitir de
 * verdade.
 */
empresasEmissorasRouter.get(
  "/me/simples-nacional",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const empresa = await buscarEmpresaDoMedico(req.medicoId!);
      if (!empresa) {
        return res.status(404).json({
          erro: "Nenhuma empresa emissora cadastrada para este médico ainda.",
        });
      }

      const dataReferencia = req.query.dataReferencia
        ? new Date(String(req.query.dataReferencia))
        : new Date();

      const calculo = await calcularPercentualSimplesNacional(
        empresa.id,
        dataReferencia
      );

      return res.json(calculo);
    } catch (err) {
      console.error("Erro ao calcular Simples Nacional:", err);
      return res.status(500).json({
        erro: "Não foi possível calcular o Simples Nacional.",
      });
    }
  }
);

/**
 * POST /empresas-emissoras/me/faturamento
 * Body: { ano, mes, valor }
 *
 * Registra (substitui) o faturamento de um mês específico — usado
 * principalmente pra preencher os meses ANTERIORES a começar a usar o
 * MedFiscal (senão o RBT12 fica incompleto nos primeiros 12 meses de
 * uso). Depois que o app começa a emitir de verdade, cada NFS-e bem
 * sucedida já soma automaticamente nessa mesma tabela — não precisa
 * mexer aqui de novo pros meses futuros.
 */
empresasEmissorasRouter.post(
  "/me/faturamento",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const empresa = await buscarEmpresaDoMedico(req.medicoId!);
      if (!empresa) {
        return res.status(404).json({
          erro: "Nenhuma empresa emissora cadastrada para este médico ainda.",
        });
      }

      const { ano, mes, valor } = req.body;
      if (!ano || !mes || valor === undefined) {
        return res.status(400).json({
          erro: "Campos obrigatórios: ano, mes, valor.",
        });
      }

      const result = await pool.query(
        `INSERT INTO faturamento_mensal (empresa_emissora_id, ano, mes, valor, origem)
         VALUES ($1, $2, $3, $4, 'manual')
         ON CONFLICT (empresa_emissora_id, ano, mes)
         DO UPDATE SET valor = $4, origem = 'manual', updated_at = now()
         RETURNING ano, mes, valor, origem`,
        [empresa.id, ano, mes, valor]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Erro ao registrar faturamento:", err);
      return res.status(500).json({
        erro: "Não foi possível registrar o faturamento desse mês.",
      });
    }
  }
);

/**
 * POST /empresas-emissoras/me/folha-pagamento
 * Body: { ano, mes, valor }
 *
 * Registra a folha de pagamento (incluindo pró-labore + encargos) de um
 * mês — necessário pra calcular o Fator R. O MedFiscal não tem folha de
 * pagamento automatizada, então isso precisa ser atualizado manualmente
 * conforme os meses forem passando (diferente do faturamento, que já
 * soma sozinho a partir das emissões).
 */
empresasEmissorasRouter.post(
  "/me/folha-pagamento",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const empresa = await buscarEmpresaDoMedico(req.medicoId!);
      if (!empresa) {
        return res.status(404).json({
          erro: "Nenhuma empresa emissora cadastrada para este médico ainda.",
        });
      }

      const { ano, mes, valor } = req.body;
      if (!ano || !mes || valor === undefined) {
        return res.status(400).json({
          erro: "Campos obrigatórios: ano, mes, valor.",
        });
      }

      const result = await pool.query(
        `INSERT INTO folha_pagamento_mensal (empresa_emissora_id, ano, mes, valor)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (empresa_emissora_id, ano, mes)
         DO UPDATE SET valor = $4, updated_at = now()
         RETURNING ano, mes, valor`,
        [empresa.id, ano, mes, valor]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Erro ao registrar folha de pagamento:", err);
      return res.status(500).json({
        erro: "Não foi possível registrar a folha de pagamento desse mês.",
      });
    }
  }
);

/**
 * POST /empresas-emissoras/me/certificado
 * Body: { pfxBase64, senha }
 *
 * Cadastra (ou troca) o certificado A1 da empresa emissora do médico.
 * Antes de guardar, abre o .pfx pra conferir a senha, se o certificado é
 * do MESMO CNPJ da empresa e se ainda está válido. O .pfx e a senha são
 * guardados CIFRADOS (AES-256-GCM, chave mestra só no .env) — nenhuma
 * rota devolve esse conteúdo depois, só titular e validade.
 */
empresasEmissorasRouter.post(
  "/me/certificado",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const empresa = await buscarEmpresaDoMedico(req.medicoId!);
      if (!empresa) {
        return res.status(404).json({
          erro: "Cadastre os dados da empresa emissora antes do certificado.",
        });
      }

      const { pfxBase64, senha } = req.body ?? {};
      if (!pfxBase64 || !senha) {
        return res.status(400).json({
          erro: "Campos obrigatórios: pfxBase64 (arquivo .pfx em base64) e senha.",
        });
      }

      const pfx = Buffer.from(String(pfxBase64), "base64");
      let dados;
      try {
        dados = lerCertificado({ pfx, senha: String(senha) });
      } catch (err: any) {
        return res.status(400).json({ erro: err?.message ?? "Certificado inválido." });
      }

      const empresaCompleta = await pool.query(
        `SELECT cnpj FROM empresas_emissoras WHERE id = $1`,
        [empresa.id]
      );
      const cnpjEmpresa = empresaCompleta.rows[0].cnpj;

      if (dados.cnpj && dados.cnpj !== cnpjEmpresa) {
        return res.status(400).json({
          erro: `Esse certificado é do CNPJ ${dados.cnpj}, mas a empresa emissora cadastrada é ${cnpjEmpresa}.`,
        });
      }
      if (dados.validoAte.getTime() < Date.now()) {
        return res.status(400).json({
          erro: `Esse certificado venceu em ${dados.validoAte.toLocaleDateString("pt-BR")}.`,
        });
      }

      await pool.query(
        `UPDATE empresas_emissoras
            SET certificado_pfx_cifrado = $1,
                certificado_senha_cifrada = $2,
                certificado_titular = $3,
                certificado_validade = $4,
                updated_at = now()
          WHERE id = $5`,
        [
          cifrar(pfx),
          cifrar(Buffer.from(String(senha), "utf-8")),
          dados.titular,
          dados.validoAte,
          empresa.id,
        ]
      );

      // Com o certificado em mãos, já busca os hospitais nas notas que a
      // empresa emitiu (segundo plano — não atrasa a resposta).
      const importacao = await iniciarImportacaoEmSegundoPlano(
        req.medicoId!,
        "certificado_cadastrado"
      ).catch((err) => {
        console.error("Não foi possível iniciar a importação de hospitais:", err);
        return null;
      });

      return res.status(201).json({
        certificado_cadastrado: true,
        certificado_titular: dados.titular,
        certificado_validade: dados.validoAte,
        importacao_hospitais: importacao,
      });
    } catch (err: any) {
      console.error("Erro ao cadastrar certificado:", err);
      return res.status(500).json({
        erro: err?.message ?? "Não foi possível cadastrar o certificado.",
      });
    }
  }
);

/**
 * GET /empresas-emissoras/me/convenio
 * Consulta no governo se o município da empresa emissora já aderiu ao
 * Emissor Nacional (evita depender de ligar pra prefeitura).
 */
empresasEmissorasRouter.get(
  "/me/convenio",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT * FROM empresas_emissoras WHERE medico_id = $1`,
        [req.medicoId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({
          erro: "Nenhuma empresa emissora cadastrada para este médico ainda.",
        });
      }
      const empresa = result.rows[0];
      const codigo = String(req.query.municipio ?? empresa.codigo_municipio_ibge);
      const consulta = await consultarConvenioMunicipio(codigo, empresa);
      return res.json(consulta);
    } catch (err: any) {
      console.error("Erro ao consultar convênio do município:", err);
      return res.status(502).json({
        erro: err?.message ?? "Não foi possível consultar o convênio do município agora.",
      });
    }
  }
);
