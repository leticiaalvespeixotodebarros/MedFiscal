import { Router, Response } from "express";
import { pool } from "../db";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth.middleware";
import {
  validarData,
  validarHorario,
  isDataFuturaOuHoje,
  dataHojeISO,
  diasEntreDatas,
  dia20DoMesSubsequente,
} from "../utils/validacao";
import {
  emitirNfseParaMedico,
  ErroEmissaoNfse,
  dataParaISO,
} from "../nfse/emitirNfse";
import { cancelarNfse, mensagemDosErrosDoGoverno } from "../nfse/cancelamento";

export const plantoesRouter = Router();

plantoesRouter.use(authMiddleware);

/**
 * POST /plantoes
 * O valor agora é opcional — a médica pode marcar "não sei o valor ainda"
 * no app. Sem valor, a NF não poderá ser emitida automaticamente até que
 * o valor seja preenchido depois (ver PATCH /:id/valor).
 *
 * Campo opcional `data_emissao_nf`: usado no fluxo de plantão retroativo
 * (data no passado) — quando informado, o plantão já nasce com a NF
 * marcada como emitida naquela data (o fluxo de confirmação/perguntas
 * sobre a data da NF e o Simples Nacional acontece no app, antes de
 * chegar aqui).
 */
plantoesRouter.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, horario, tomador_id, valor, descricao_nf, data_emissao_nf } =
      req.body;

    if (!data || !horario || !tomador_id) {
      return res.status(400).json({
        erro: "Campos obrigatórios: data, horario, tomador_id.",
      });
    }

    if (valor !== undefined && (typeof valor !== "number" || valor <= 0)) {
      return res.status(400).json({ erro: "valor deve ser um número positivo." });
    }

    const erroData = validarData(data);
    if (erroData) {
      return res.status(400).json({ erro: erroData, campo: "data" });
    }

    const erroHorario = validarHorario(horario);
    if (erroHorario) {
      return res.status(400).json({ erro: erroHorario, campo: "horario" });
    }

    let dataEmissaoFinal: string | null = null;
    let statusInicial = "agendado";

    if (data_emissao_nf) {
      const erroDataEmissao = validarData(data_emissao_nf);
      if (erroDataEmissao) {
        return res.status(400).json({
          erro: erroDataEmissao,
          campo: "data_emissao_nf",
        });
      }
      dataEmissaoFinal = data_emissao_nf;
      statusInicial = "nf_emitida";
    }

    const tomadorResult = await pool.query(
      `SELECT COALESCE(apelido, razao_social) AS nome_exibicao
         FROM tomadores WHERE id = $1 AND medico_id = $2`,
      [tomador_id, req.medicoId]
    );

    if (tomadorResult.rows.length === 0) {
      return res.status(400).json({
        erro: "Hospital selecionado não foi encontrado.",
        campo: "tomador_id",
      });
    }

    const nomeHospital = tomadorResult.rows[0].nome_exibicao;

    const result = await pool.query(
      `INSERT INTO plantoes (medico_id, data, horario, hospital, tomador_id, valor, descricao_nf, status, data_emissao_nf)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, data, horario, hospital, tomador_id, valor, descricao_nf, status, data_emissao_nf, created_at`,
      [
        req.medicoId,
        data,
        horario,
        nomeHospital,
        tomador_id,
        valor ?? null,
        descricao_nf ?? null,
        statusInicial,
        dataEmissaoFinal,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao criar plantão:", err);
    return res.status(500).json({
      erro: "Não foi possível salvar o plantão. Tente novamente em instantes.",
    });
  }
});

/**
 * GET /plantoes
 */
plantoesRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = req.query;

    const params: unknown[] = [req.medicoId];
    let query = `SELECT id, data, horario, hospital, tomador_id, valor, descricao_nf, status, data_emissao_nf, observacao_cancelamento, nfse_chave_acesso, created_at
                   FROM plantoes
                  WHERE medico_id = $1`;

    if (status) {
      params.push(status);
      query += ` AND status = $2`;
    }

    query += ` ORDER BY data DESC, horario DESC`;

    const result = await pool.query(query, params);

    return res.json(result.rows);
  } catch (err) {
    console.error("Erro ao listar plantões:", err);
    return res.status(500).json({
      erro: "Não foi possível carregar os plantões. Tente novamente em instantes.",
    });
  }
});

/**
 * PUT /plantoes/:id
 * Valor também opcional aqui (edição normal, só plantões de hoje/futuro).
 */
plantoesRouter.put("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { data, horario, tomador_id, valor, descricao_nf } = req.body;

    if (!data || !horario || !tomador_id) {
      return res.status(400).json({
        erro: "Campos obrigatórios: data, horario, tomador_id.",
      });
    }

    if (valor !== undefined && (typeof valor !== "number" || valor <= 0)) {
      return res.status(400).json({ erro: "valor deve ser um número positivo." });
    }

    const erroData = validarData(data);
    if (erroData) {
      return res.status(400).json({ erro: erroData, campo: "data" });
    }

    const erroHorario = validarHorario(horario);
    if (erroHorario) {
      return res.status(400).json({ erro: erroHorario, campo: "horario" });
    }

    if (!isDataFuturaOuHoje(data)) {
      return res.status(400).json({
        erro: "A nova data não pode ser no passado.",
        campo: "data",
      });
    }

    const existente = await pool.query(
      `SELECT data, horario, hospital, tomador_id, valor
         FROM plantoes WHERE id = $1 AND medico_id = $2`,
      [id, req.medicoId]
    );

    if (existente.rows.length === 0) {
      return res.status(404).json({ erro: "Plantão não encontrado." });
    }

    const anterior = existente.rows[0];
    const dataAnteriorISO = dataParaISO(anterior.data);

    if (!isDataFuturaOuHoje(dataAnteriorISO)) {
      return res.status(400).json({
        erro:
          "Esse plantão já aconteceu e não pode mais ser editado por aqui. Use a opção de marcar como não realizado.",
      });
    }

    const tomadorResult = await pool.query(
      `SELECT COALESCE(apelido, razao_social) AS nome_exibicao
         FROM tomadores WHERE id = $1 AND medico_id = $2`,
      [tomador_id, req.medicoId]
    );

    if (tomadorResult.rows.length === 0) {
      return res.status(400).json({
        erro: "Hospital selecionado não foi encontrado.",
        campo: "tomador_id",
      });
    }

    const nomeHospital = tomadorResult.rows[0].nome_exibicao;
    const valorNovo = valor ?? null;

    const result = await pool.query(
      `UPDATE plantoes
          SET data = $1, horario = $2, hospital = $3, tomador_id = $4,
              valor = $5, descricao_nf = $6, updated_at = now()
        WHERE id = $7 AND medico_id = $8
      RETURNING id, data, horario, hospital, tomador_id, valor, descricao_nf, status, created_at`,
      [data, horario, nomeHospital, tomador_id, valorNovo, descricao_nf ?? null, id, req.medicoId]
    );

    const mudancas: { campo: string; anterior: string; novo: string }[] = [];

    if (dataAnteriorISO !== data) {
      mudancas.push({ campo: "data", anterior: dataAnteriorISO, novo: data });
    }
    if (anterior.horario !== horario) {
      mudancas.push({ campo: "horario", anterior: anterior.horario, novo: horario });
    }
    if (anterior.hospital !== nomeHospital) {
      mudancas.push({ campo: "hospital", anterior: anterior.hospital, novo: nomeHospital });
    }
    const valorAnteriorNum = anterior.valor !== null ? Number(anterior.valor) : null;
    if (valorAnteriorNum !== valorNovo) {
      mudancas.push({
        campo: "valor",
        anterior: valorAnteriorNum !== null ? String(valorAnteriorNum) : "não informado",
        novo: valorNovo !== null ? String(valorNovo) : "não informado",
      });
    }

    for (const mudanca of mudancas) {
      await pool.query(
        `INSERT INTO plantoes_historico (plantao_id, medico_id, campo, valor_anterior, valor_novo)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, req.medicoId, mudanca.campo, mudanca.anterior, mudanca.novo]
      );
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao editar plantão:", err);
    return res.status(500).json({
      erro: "Não foi possível editar o plantão. Tente novamente em instantes.",
    });
  }
});

/**
 * PATCH /plantoes/:id/valor
 * Body: { valor: number, descricao_nf?: string }
 *
 * Rota específica para completar o valor de um plantão que ficou sem
 * valor definido (marcado como "não sei o valor ainda" na criação).
 * Diferente do PUT normal, funciona em plantões PASSADOS também — porque
 * aqui a intenção não é editar o agendamento, é só destravar a emissão
 * da NF completando um dado que faltou. Só funciona se o valor ainda
 * estiver vazio (evita sobrescrever sem querer um valor já preenchido).
 */
plantoesRouter.patch(
  "/:id/valor",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { valor, descricao_nf } = req.body;

      if (valor === undefined || typeof valor !== "number" || valor <= 0) {
        return res.status(400).json({ erro: "Informe um valor numérico válido." });
      }

      const existente = await pool.query(
        `SELECT valor, descricao_nf FROM plantoes WHERE id = $1 AND medico_id = $2`,
        [id, req.medicoId]
      );

      if (existente.rows.length === 0) {
        return res.status(404).json({ erro: "Plantão não encontrado." });
      }

      const anterior = existente.rows[0];

      if (anterior.valor !== null) {
        return res.status(400).json({
          erro: "Esse plantão já tem um valor preenchido.",
        });
      }

      const result = await pool.query(
        `UPDATE plantoes
            SET valor = $1, descricao_nf = COALESCE($2, descricao_nf), updated_at = now()
          WHERE id = $3 AND medico_id = $4
        RETURNING id, data, horario, hospital, tomador_id, valor, descricao_nf, status, created_at`,
        [valor, descricao_nf ?? null, id, req.medicoId]
      );

      const mudancas: { campo: string; anterior: string; novo: string }[] = [
        { campo: "valor", anterior: "não informado", novo: String(valor) },
      ];

      if (descricao_nf && descricao_nf !== anterior.descricao_nf) {
        mudancas.push({
          campo: "descricao_nf",
          anterior: anterior.descricao_nf ?? "não informado",
          novo: descricao_nf,
        });
      }

      for (const mudanca of mudancas) {
        await pool.query(
          `INSERT INTO plantoes_historico (plantao_id, medico_id, campo, valor_anterior, valor_novo)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, req.medicoId, mudanca.campo, mudanca.anterior, mudanca.novo]
        );
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error("Erro ao completar valor do plantão:", err);
      return res.status(500).json({
        erro: "Não foi possível salvar o valor. Tente novamente em instantes.",
      });
    }
  }
);

/**
 * GET /plantoes/:id/historico
 */
plantoesRouter.get(
  "/:id/historico",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const plantao = await pool.query(
        `SELECT id FROM plantoes WHERE id = $1 AND medico_id = $2`,
        [id, req.medicoId]
      );

      if (plantao.rows.length === 0) {
        return res.status(404).json({ erro: "Plantão não encontrado." });
      }

      const historico = await pool.query(
        `SELECT id, campo, valor_anterior, valor_novo, editado_em
           FROM plantoes_historico
          WHERE plantao_id = $1
          ORDER BY editado_em DESC`,
        [id]
      );

      return res.json(historico.rows);
    } catch (err) {
      console.error("Erro ao buscar histórico do plantão:", err);
      return res.status(500).json({
        erro: "Não foi possível carregar o histórico deste plantão.",
      });
    }
  }
);

/**
 * PATCH /plantoes/:id/emitir-nf
 *
 * Emite a NFS-e de verdade pro plantão (usa a empresa emissora e o
 * hospital cadastrados). Substitui o antigo atalho manual que só
 * marcava o status sem emitir nada de verdade.
 */
/**
 * Plantões com emissão em andamento neste processo do backend — evita
 * que dois toques seguidos no botão (ou duas requisições simultâneas)
 * emitam DUAS notas pro mesmo plantão: o status só vira "nf_emitida"
 * depois da resposta do governo, então sem essa trava as duas
 * requisições passariam pela checagem de status ao mesmo tempo.
 */
const emissoesEmAndamento = new Set<string>();

plantoesRouter.patch(
  "/:id/emitir-nf",
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    if (emissoesEmAndamento.has(id)) {
      return res.status(409).json({
        erro: "A NF desse plantão já está sendo emitida. Aguarde alguns segundos e atualize a lista.",
      });
    }
    emissoesEmAndamento.add(id);
    try {

      const existente = await pool.query(
        `SELECT p.status, p.valor, p.data, p.descricao_nf, p.tomador_id,
                t.cnpj, t.razao_social, t.apelido, t.logradouro, t.numero,
                t.complemento, t.bairro, t.cep, t.codigo_municipio_ibge,
                t.telefone, t.email
           FROM plantoes p
           LEFT JOIN tomadores t ON t.id = p.tomador_id
          WHERE p.id = $1 AND p.medico_id = $2`,
        [id, req.medicoId]
      );

      if (existente.rows.length === 0) {
        return res.status(404).json({ erro: "Plantão não encontrado." });
      }

      const plantao = existente.rows[0];

      if (plantao.status !== "agendado") {
        return res.status(400).json({
          erro: "Esse plantão já não está mais como agendado.",
        });
      }

      if (!plantao.tomador_id) {
        return res.status(400).json({
          erro:
            "Esse plantão não tem hospital vinculado — não dá pra emitir a NF.",
        });
      }

      if (plantao.valor === null) {
        return res.status(400).json({
          erro:
            "Esse plantão ainda não tem valor definido — não dá pra emitir a NF.",
        });
      }

      const dataPlantaoISO = dataParaISO(plantao.data);

      let resultadoEmissao;
      try {
        resultadoEmissao = await emitirNfseParaMedico(
          req.medicoId!,
          {
            cnpj: plantao.cnpj,
            razaoSocial: plantao.apelido || plantao.razao_social,
            codigoMunicipioIbge: plantao.codigo_municipio_ibge,
            cep: plantao.cep,
            logradouro: plantao.logradouro,
            numero: plantao.numero,
            complemento: plantao.complemento ?? undefined,
            bairro: plantao.bairro,
            telefone: plantao.telefone ?? undefined,
            email: plantao.email ?? undefined,
          },
          {
            descricao:
              plantao.descricao_nf || `Plantão médico - ${plantao.razao_social}`,
            valor: Number(plantao.valor),
          },
          dataPlantaoISO
        );
      } catch (erroEmissao: any) {
        if (erroEmissao instanceof ErroEmissaoNfse) {
          return res.status(400).json({ erro: erroEmissao.message });
        }
        if (erroEmissao?.emissaoId) {
          return res.status(502).json({
            erro: erroEmissao.message,
            emissaoId: erroEmissao.emissaoId,
          });
        }
        throw erroEmissao;
      }

      if (!resultadoEmissao.sucesso) {
        return res.status(400).json({
          erro: `O governo rejeitou a emissão da NF: ${mensagemDosErrosDoGoverno(
            resultadoEmissao.resultadoEnvio.corpoResposta
          )}`,
          resultadoEnvio: resultadoEmissao.resultadoEnvio,
        });
      }

      const result = await pool.query(
        `UPDATE plantoes
            SET status = 'nf_emitida', data_emissao_nf = $1,
                nfse_chave_acesso = $2, updated_at = now()
          WHERE id = $3 AND medico_id = $4
        RETURNING id, data, horario, hospital, tomador_id, valor, descricao_nf,
                  status, data_emissao_nf, nfse_chave_acesso, created_at`,
        [dataPlantaoISO, resultadoEmissao.chaveAcesso, id, req.medicoId]
      );

      await pool.query(
        `INSERT INTO plantoes_historico (plantao_id, medico_id, campo, valor_anterior, valor_novo)
         VALUES ($1, $2, 'status', 'agendado', 'nf_emitida')`,
        [id, req.medicoId]
      );

      return res.json(result.rows[0]);
    } catch (err: any) {
      console.error("Erro ao emitir NF:", err);
      return res.status(500).json({
        erro: err?.message ?? "Não foi possível emitir a NF.",
      });
    } finally {
      emissoesEmAndamento.delete(id);
    }
  }
);

/**
 * POST /plantoes/:id/nao-realizado
 * Body: { simplesJaEntregue?: boolean, dasJaPaga?: boolean,
 *         observacaoCancelamento?: string }
 *
 * Implementa o fluxo completo de "plantão não foi realizado":
 * - Se a NF ainda não foi emitida: exclui o plantão direto.
 * - Se a NF já foi emitida e ainda dentro do prazo de cancelamento
 *   (45 dias da emissão): cancela a NF e calcula o efeito fiscal sobre o
 *   Simples Nacional, perguntando (via erro específico, respondido pelo
 *   app) se o Simples já foi entregue e se a DAS já foi paga, quando
 *   isso for relevante.
 * - Se a NF já foi emitida e fora do prazo de cancelamento: não cancela
 *   sozinho — abre processo administrativo (o app deve orientar a buscar
 *   a carta de não prestação de serviço com o tomador).
 */
plantoesRouter.post(
  "/:id/nao-realizado",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { simplesJaEntregue, dasJaPaga, observacaoCancelamento } = req.body;

      const existente = await pool.query(
        `SELECT data, status, data_emissao_nf, nfse_chave_acesso FROM plantoes WHERE id = $1 AND medico_id = $2`,
        [id, req.medicoId]
      );

      if (existente.rows.length === 0) {
        return res.status(404).json({ erro: "Plantão não encontrado." });
      }

      const plantao = existente.rows[0];
      const dataPlantaoISO = dataParaISO(plantao.data);

      if (isDataFuturaOuHoje(dataPlantaoISO)) {
        return res.status(400).json({
          erro: "Esse plantão ainda não aconteceu — use editar ou excluir normalmente.",
        });
      }

      if (plantao.status === "cancelado") {
        return res.status(400).json({ erro: "Esse plantão já está cancelado." });
      }

      // Caso 1: NF ainda não foi emitida -> exclui o plantão direto.
      if (plantao.status === "agendado" || plantao.status === "aguardando_nova_data") {
        await pool.query(`DELETE FROM plantoes WHERE id = $1 AND medico_id = $2`, [
          id,
          req.medicoId,
        ]);
        return res.json({ acao: "excluido" });
      }

      // A partir daqui, a NF já tinha sido emitida (nf_emitida/nf_confirmada).
      if (!plantao.data_emissao_nf) {
        return res.status(400).json({
          erro:
            "Esse plantão está marcado como NF emitida, mas não tem data de emissão registrada.",
        });
      }

      const dataEmissaoISO = dataParaISO(plantao.data_emissao_nf);
      const hoje = dataHojeISO();
      const diasDesdeEmissao = diasEntreDatas(dataEmissaoISO, hoje);
      const dentroPrazo = diasDesdeEmissao <= 45;

      // Caso 2: fora do prazo de cancelamento simples -> processo administrativo.
      if (!dentroPrazo) {
        await pool.query(
          `UPDATE plantoes
              SET status = 'cancelamento_administrativo',
                  observacao_cancelamento = $1, updated_at = now()
            WHERE id = $2 AND medico_id = $3`,
          [observacaoCancelamento ?? null, id, req.medicoId]
        );
        await pool.query(
          `INSERT INTO plantoes_historico (plantao_id, medico_id, campo, valor_anterior, valor_novo)
           VALUES ($1, $2, 'status', $3, 'cancelamento_administrativo')`,
          [id, req.medicoId, plantao.status]
        );
        return res.json({
          acao: "processo_administrativo",
          mensagem:
            "O prazo de cancelamento simples da NF (45 dias) já passou. Você vai precisar da carta de não prestação de serviço assinada pelo tomador para abrir um processo administrativo de cancelamento junto à contabilidade.",
        });
      }

      // Caso 3: dentro do prazo -> cancelamento simples + regra fiscal do Simples Nacional.
      const dia20Subsequente = dia20DoMesSubsequente(dataEmissaoISO);
      const depoisDoDia20 = hoje > dia20Subsequente;

      let mensagemFiscal: string;

      if (depoisDoDia20) {
        mensagemFiscal =
          "Esse cancelamento acontece depois do dia 20 do mês seguinte à emissão da NF. Isso altera o imposto: o crédito da DAS paga será tomado no mês seguinte (se ela tiver sido paga), e será necessário retificar a declaração do Simples Nacional.";
      } else {
        if (simplesJaEntregue === undefined) {
          return res.status(409).json({ erro: "PRECISA_RESPOSTA_SIMPLES" });
        }
        if (simplesJaEntregue) {
          if (dasJaPaga === undefined) {
            return res.status(409).json({ erro: "PRECISA_RESPOSTA_DAS" });
          }
          if (dasJaPaga) {
            mensagemFiscal =
              "Como o Simples Nacional já foi entregue e a DAS já foi paga, o crédito será tomado no mês seguinte e será necessário retificar a declaração do Simples Nacional (mesmo procedimento de quem cancela após o dia 20).";
          } else {
            mensagemFiscal =
              "Como o Simples Nacional já foi entregue mas a DAS ainda não foi paga: retifique a declaração do Simples, e substitua o arquivo da DAS desse mês pelo valor corrigido.";
          }
        } else {
          mensagemFiscal =
            "O Simples Nacional desse mês ainda não foi entregue — o valor corrigido já entra direto na declaração original, sem necessidade de nenhuma ação extra.";
        }
      }

      // Se a NF foi emitida de verdade pelo app (tem chave de acesso),
      // cancela no Sistema Nacional ANTES de mudar o plantão — se o
      // governo recusar, nada muda aqui e a usuária vê o motivo.
      let mensagemNf =
        "Essa NF não foi emitida pelo app (não tem chave de acesso registrada) — cancele-a manualmente no emissor da prefeitura/governo.";
      if (plantao.nfse_chave_acesso) {
        try {
          const cancelamento = await cancelarNfse(
            req.medicoId!,
            { chaveAcesso: plantao.nfse_chave_acesso },
            2,
            observacaoCancelamento
              ? `Servico nao prestado: ${observacaoCancelamento}`
              : "Servico nao prestado - plantao nao realizado"
          );
          if (!cancelamento.sucesso) {
            return res.status(400).json({ erro: cancelamento.mensagem });
          }
          mensagemNf = "A NFS-e foi cancelada no Sistema Nacional.";
        } catch (erroCancelamento: any) {
          if (erroCancelamento instanceof ErroEmissaoNfse) {
            return res.status(400).json({ erro: erroCancelamento.message });
          }
          console.error("Erro ao cancelar NFS-e do plantão:", erroCancelamento);
          return res.status(502).json({
            erro:
              "Não foi possível falar com o governo pra cancelar a NF agora. Nada foi alterado — tente de novo em instantes.",
          });
        }
      }

      await pool.query(
        `UPDATE plantoes SET status = 'cancelado', observacao_cancelamento = $3, updated_at = now()
          WHERE id = $1 AND medico_id = $2`,
        [id, req.medicoId, observacaoCancelamento ?? null]
      );
      await pool.query(
        `INSERT INTO plantoes_historico (plantao_id, medico_id, campo, valor_anterior, valor_novo)
         VALUES ($1, $2, 'status', $3, 'cancelado')`,
        [id, req.medicoId, plantao.status]
      );

      return res.json({ acao: "cancelado", mensagemFiscal, mensagemNf });
    } catch (err) {
      console.error("Erro ao marcar plantão como não realizado:", err);
      return res.status(500).json({
        erro: "Não foi possível processar. Tente novamente em instantes.",
      });
    }
  }
);

/**
 * DELETE /plantoes/:id
 */
plantoesRouter.delete(
  "/:id",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const existente = await pool.query(
        `SELECT data FROM plantoes WHERE id = $1 AND medico_id = $2`,
        [id, req.medicoId]
      );

      if (existente.rows.length === 0) {
        return res.status(404).json({ erro: "Plantão não encontrado." });
      }

      const dataAtualDoPlantao = (existente.rows[0].data as Date)
        .toISOString()
        .slice(0, 10);

      if (!isDataFuturaOuHoje(dataAtualDoPlantao)) {
        return res.status(400).json({
          erro:
            "Esse plantão já aconteceu e não pode mais ser excluído diretamente. Use a opção de marcar como não realizado.",
        });
      }

      await pool.query(`DELETE FROM plantoes WHERE id = $1 AND medico_id = $2`, [
        id,
        req.medicoId,
      ]);

      return res.status(204).send();
    } catch (err) {
      console.error("Erro ao excluir plantão:", err);
      return res.status(500).json({
        erro: "Não foi possível excluir o plantão. Tente novamente em instantes.",
      });
    }
  }
);
