import { Router, Response } from "express";
import axios from "axios";
import { pool } from "../db";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth.middleware";
import { criarAgenteHttpsComCertificado, obterUrlBaseAdn } from "./certificado";
import { montarDpsXml, dataHoraAtualBrasilia } from "./dps";
import { obterProximoNumeroDps } from "./numeracao";
import { assinarXmlDps } from "./assinatura";
import { enviarDpsParaSefin } from "./envio";
import {
  calcularPercentualSimplesNacional,
  registrarFaturamentoAutomatico,
} from "./simples-nacional";
import { emitirNfseParaMedico, ErroEmissaoNfse, dataParaISO } from "./emitirNfse";
import { obterContextoEmissao } from "./certificadoEmpresa";
import { cancelarNfse, MotivoCancelamento } from "./cancelamento";

export const nfseRouter = Router();

nfseRouter.use(authMiddleware);

/**
 * GET /nfse/teste-conexao
 *
 * FASE 1 do desenvolvimento do emissor de NFS-e: só testa se o
 * certificado digital configurado consegue autenticar via mTLS no
 * Ambiente de Dados Nacional (ADN), sem tentar emitir nenhuma nota.
 *
 * Não é uma rota pra usar no app — é só pra confirmar, via curl/Postman,
 * que a configuração do certificado está funcionando antes de avançar
 * pra montagem/assinatura da DPS.
 */
nfseRouter.get(
  "/teste-conexao",
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const agente = criarAgenteHttpsComCertificado();
      const urlBase = obterUrlBaseAdn();

      // Endpoint de consulta de documentos fiscais do contribuinte
      // (NSU 0 = a partir do início). Não emite nada, só lista/consulta —
      // serve como teste de conectividade e autenticação.
      const url = `${urlBase}/contribuintes/DFe/0`;

      const resposta = await axios.get(url, {
        httpsAgent: agente,
        timeout: 15000,
        validateStatus: () => true, // queremos ver o status mesmo se não for 200
      });

      return res.json({
        sucesso: true,
        urlTestada: url,
        statusRecebido: resposta.status,
        corpoResposta: resposta.data,
      });
    } catch (err: any) {
      console.error("Erro no teste de conexão com o ADN:", err);
      return res.status(500).json({
        sucesso: false,
        erro: err?.message ?? "Erro desconhecido ao tentar conectar no ADN.",
        // Erros de certificado geralmente aparecem em err.code, ex:
        // "ERR_OSSL_PKCS12_MAC_VERIFY_FAILURE" (senha errada) ou
        // "ENOENT" (caminho do arquivo errado).
        codigoErro: err?.code ?? null,
      });
    }
  }
);

// (Rotas de teste da fase de desenvolvimento, que usavam dados reais de empresas
// e clientes fixos no código, foram removidas desta cópia pública — LGPD.)

/**
 * POST /nfse/emitir
 *
 * Rota GENÉRICA de emissão — busca os dados fiscais do PRESTADOR no
 * banco (tabela empresas_emissoras, pelo médico autenticado) em vez de
 * ter uma empresa fixa no código. Essa é a rota que o app de verdade
 * deve usar dali pra frente — as rotas de teste acima (emitir-teste-real,
 * emitir-lote-kaptar, emitir-teste-girardello) continuam existindo só
 * como referência histórica de como cada empresa foi validada, mas não
 * devem ser a forma definitiva de emitir.
 *
 * Corpo esperado:
 * {
 *   tomador: { cnpj?, cpf?, razaoSocial, codigoMunicipioIbge, cep,
 *              logradouro, numero, complemento?, bairro, telefone?, email? },
 *   servico: { descricao, valor, codigoTribNac?, codigoNbs? },
 *   dataCompetencia: "AAAA-MM-DD"
 * }
 * (codigoTribNac/codigoNbs do serviço são opcionais — se omitidos, usa
 * o cadastrado na empresa emissora, já que pra a maioria dos médicos o
 * serviço prestado é sempre "Medicina").
 */
nfseRouter.post(
  "/emitir",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { tomador, servico, dataCompetencia } = req.body;

      if (!tomador || !servico || !dataCompetencia) {
        return res.status(400).json({
          erro: "Campos obrigatórios: tomador, servico, dataCompetencia.",
        });
      }

      const resultado = await emitirNfseParaMedico(
        req.medicoId!,
        tomador,
        servico,
        dataCompetencia
      );

      return res.json({
        sucesso: resultado.sucesso,
        ambiente: resultado.ambiente,
        numeroDpsUsado: resultado.numeroDpsUsado,
        idDps: resultado.idDps,
        emissaoId: resultado.emissaoId,
        calculoSimplesNacional: resultado.calculoSimplesNacional,
        resultadoEnvio: resultado.resultadoEnvio,
      });
    } catch (err: any) {
      console.error("Erro ao emitir NFS-e:", err);
      if (err instanceof ErroEmissaoNfse) {
        return res.status(400).json({ sucesso: false, erro: err.message });
      }
      if (err?.emissaoId) {
        return res.status(502).json({
          sucesso: false,
          erro: err.message,
          emissaoId: err.emissaoId,
        });
      }
      return res.status(500).json({
        sucesso: false,
        erro: err?.message ?? "Erro desconhecido ao emitir.",
      });
    }
  }
);

/**
 * GET /nfse/emissoes
 * Histórico de emissões (tentativas) do médico autenticado, mais
 * recente primeiro.
 */
nfseRouter.get(
  "/emissoes",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT id, cnpj_prestador, serie, numero_dps, ambiente, status,
                chave_acesso, tomador_documento, data_competencia, valor,
                erro_mensagem, cancelada_em, cancelamento_motivo,
                created_at, updated_at
           FROM nfse_emissoes
          WHERE medico_id = $1
          ORDER BY created_at DESC`,
        [req.medicoId]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error("Erro ao listar emissões:", err);
      return res.status(500).json({
        erro: "Não foi possível carregar o histórico de emissões.",
      });
    }
  }
);

/**
 * GET /nfse/emissoes/:id
 * Detalhe de uma emissão específica — usar pra conferir o status antes
 * de decidir reenviar (principalmente quando o status for
 * "indeterminado").
 */
nfseRouter.get(
  "/emissoes/:id",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT * FROM nfse_emissoes WHERE id = $1 AND medico_id = $2`,
        [req.params.id, req.medicoId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ erro: "Emissão não encontrada." });
      }
      return res.json(result.rows[0]);
    } catch (err) {
      console.error("Erro ao buscar emissão:", err);
      return res.status(500).json({
        erro: "Não foi possível carregar os detalhes dessa emissão.",
      });
    }
  }
);

/**
 * POST /nfse/emissoes/:id/reenviar
 * Reenvia uma emissão que ficou "erro" ou "indeterminado", reaproveitando
 * o MESMO número de DPS já reservado (nunca gera um número novo aqui —
 * é exatamente isso que evita duplicar a nota). Bloqueado se o status já
 * for "sucesso".
 */
nfseRouter.post(
  "/emissoes/:id/reenviar",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const emissaoResult = await pool.query(
        `SELECT * FROM nfse_emissoes WHERE id = $1 AND medico_id = $2`,
        [req.params.id, req.medicoId]
      );

      if (emissaoResult.rows.length === 0) {
        return res.status(404).json({ erro: "Emissão não encontrada." });
      }

      const emissao = emissaoResult.rows[0];

      if (emissao.status === "sucesso") {
        return res.status(400).json({
          erro:
            "Essa emissão já teve sucesso (tem chave de acesso) — reenviar geraria uma nota duplicada. Não permitido.",
        });
      }

      const empresaResult = await pool.query(
        `SELECT * FROM empresas_emissoras WHERE medico_id = $1`,
        [req.medicoId]
      );
      const empresa = empresaResult.rows[0];
      if (!empresa) {
        return res.status(400).json({
          erro: "Nenhuma empresa emissora cadastrada para este médico.",
        });
      }
      const tomador = emissao.tomador_json;
      const servico = emissao.servico_json;
      // O pg devolve DATE como objeto Date — a DPS precisa de "AAAA-MM-DD".
      const dataCompetencia = dataParaISO(emissao.data_competencia);

      let contexto;
      try {
        contexto = obterContextoEmissao(empresa);
      } catch (erroContexto: any) {
        if (erroContexto instanceof ErroEmissaoNfse) {
          return res.status(400).json({ erro: erroContexto.message });
        }
        throw erroContexto;
      }
      if (contexto.ambiente !== emissao.ambiente) {
        return res.status(400).json({
          erro: `Essa tentativa foi feita em ${emissao.ambiente}, mas a empresa agora está em ${contexto.ambiente}. Não dá pra reenviar com o mesmo número em outro ambiente — emita de novo.`,
        });
      }

      const calculoSimples = await calcularPercentualSimplesNacional(
        empresa.id,
        new Date(dataCompetencia + "T12:00:00")
      );

      const xmlDps = montarDpsXml({
        ambiente: contexto.ambiente,
        dataHoraEmissao: dataHoraAtualBrasilia(),
        serie: emissao.serie,
        numeroDps: emissao.numero_dps,
        dataCompetencia,
        codigoMunicipioEmissao: empresa.codigo_municipio_ibge,
        percentualAproxTributosSN: calculoSimples.aliquotaEfetivaPercentual,
        prestador: {
          cnpj: empresa.cnpj,
          inscricaoMunicipal: empresa.inscricao_municipal ?? undefined,
          telefone: empresa.telefone ?? undefined,
          email: empresa.email ?? undefined,
          opSimpNac: empresa.op_simp_nac,
          regApTribSN: empresa.reg_ap_trib_sn,
        },
        tomador,
        servico: {
          descricao: servico.descricao,
          valor: Number(servico.valor),
          codigoTribNac: servico.codigoTribNac ?? empresa.codigo_trib_nac,
          codigoNbs: servico.codigoNbs ?? empresa.codigo_nbs ?? undefined,
        },
      });

      const idMatch = xmlDps.match(/<infDPS Id="([^"]+)"/);
      const idElemento = idMatch?.[1];
      if (!idElemento) {
        throw new Error("Não foi possível extrair o Id da DPS gerada.");
      }

      const xmlAssinado = assinarXmlDps(xmlDps, idElemento, contexto.certificado);

      let resultadoEnvio;
      try {
        resultadoEnvio = await enviarDpsParaSefin(xmlAssinado, {
          certificado: contexto.certificado,
          ambiente: contexto.ambiente,
        });
      } catch (erroEnvio: any) {
        await pool.query(
          `UPDATE nfse_emissoes SET status = 'indeterminado', erro_mensagem = $1, updated_at = now() WHERE id = $2`,
          [erroEnvio?.message ?? "Erro de rede desconhecido", emissao.id]
        );
        return res.status(502).json({
          sucesso: false,
          erro:
            "A chamada pro governo falhou de novo antes de receber resposta. Confira o status antes de tentar mais uma vez.",
        });
      }

      const sucesso = resultadoEnvio.status === 201;
      const chaveAcesso = resultadoEnvio.corpoResposta?.chaveAcesso ?? null;

      await pool.query(
        `UPDATE nfse_emissoes
            SET status = $1, chave_acesso = $2, resposta_governo = $3,
                erro_mensagem = $4, updated_at = now()
          WHERE id = $5`,
        [
          sucesso ? "sucesso" : "erro",
          chaveAcesso,
          JSON.stringify(resultadoEnvio.corpoResposta),
          sucesso
            ? null
            : JSON.stringify(resultadoEnvio.corpoResposta?.erros ?? null),
          emissao.id,
        ]
      );

      if (sucesso) {
        await registrarFaturamentoAutomatico(
          empresa.id,
          dataCompetencia,
          Number(servico.valor)
        );
      }

      return res.json({
        sucesso,
        numeroDpsUsado: emissao.numero_dps,
        idDps: idElemento,
        calculoSimplesNacional: calculoSimples,
        resultadoEnvio,
      });
    } catch (err: any) {
      console.error("Erro ao reenviar emissão:", err);
      return res.status(500).json({
        sucesso: false,
        erro: err?.message ?? "Erro desconhecido ao reenviar.",
      });
    }
  }
);


/**
 * POST /nfse/emissoes/:id/cancelar
 * Body: { cMotivo?: 1|2|9, justificativa?: string }
 *   cMotivo: 1 = Erro na emissão, 2 = Serviço não prestado (padrão), 9 = Outros
 *
 * Cancela de verdade no Sistema Nacional (evento e101101) uma NFS-e
 * emitida com sucesso. Ao cancelar, estorna o valor do faturamento do
 * mês (pra o cálculo do Simples Nacional continuar certo).
 */
nfseRouter.post(
  "/emissoes/:id/cancelar",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const cMotivoNum = Number(req.body?.cMotivo ?? 2);
      if (![1, 2, 9].includes(cMotivoNum)) {
        return res.status(400).json({
          erro: "cMotivo inválido. Use 1 (erro na emissão), 2 (serviço não prestado) ou 9 (outros).",
        });
      }
      const resultado = await cancelarNfse(
        req.medicoId!,
        { emissaoId: req.params.id },
        cMotivoNum as MotivoCancelamento,
        String(req.body?.justificativa ?? "")
      );
      if (resultado.sucesso) {
        await pool.query(
          `UPDATE plantoes SET status = 'cancelado', updated_at = now()
            WHERE medico_id = $1 AND nfse_chave_acesso = $2 AND status <> 'cancelado'`,
          [req.medicoId, resultado.chaveAcesso]
        );
      }
      return res.status(resultado.sucesso ? 200 : 400).json(resultado);
    } catch (err: any) {
      if (err instanceof ErroEmissaoNfse) {
        return res.status(400).json({ sucesso: false, erro: err.message });
      }
      console.error("Erro ao cancelar NFS-e:", err);
      return res.status(502).json({
        sucesso: false,
        erro:
          "Não foi possível falar com o governo pra cancelar agora. Nada foi alterado — tente de novo em instantes.",
      });
    }
  }
);
