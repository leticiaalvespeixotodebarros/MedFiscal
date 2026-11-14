/**
 * backend/src/nfse/emitirNfse.ts
 *
 * Lógica central de emissão de uma NFS-e — extraída da rota
 * POST /nfse/emitir pra poder ser reaproveitada também pela emissão
 * automática disparada a partir de um plantão (ver
 * plantoes.routes.ts), sem duplicar código.
 */

import { pool } from "../db";
import { montarDpsXml, dataHoraAtualBrasilia } from "./dps";
import { obterProximoNumeroDps } from "./numeracao";
import { assinarXmlDps } from "./assinatura";
import { enviarDpsParaSefin, ResultadoEnvioDps } from "./envio";
import {
  calcularPercentualSimplesNacional,
  registrarFaturamentoAutomatico,
  ResultadoCalculoSimples,
} from "./simples-nacional";
import { ErroEmissaoNfse } from "./erros";
import { obterContextoEmissao } from "./certificadoEmpresa";

/**
 * Converte uma data (Date vindo do pg para colunas DATE, ou string) em
 * "AAAA-MM-DD" usando o calendário LOCAL — evita o deslocamento de fuso
 * do toISOString(), que pode jogar a data pro dia anterior/seguinte.
 */
export function dataParaISO(valor: Date | string): string {
  if (typeof valor === "string") return valor.slice(0, 10);
  const a = valor.getFullYear();
  const m = String(valor.getMonth() + 1).padStart(2, "0");
  const d = String(valor.getDate()).padStart(2, "0");
  return `${a}-${m}-${d}`;
}

export interface DadosTomadorEmissao {
  cnpj?: string;
  cpf?: string;
  razaoSocial: string;
  codigoMunicipioIbge: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  telefone?: string;
  email?: string;
}

export interface DadosServicoEmissao {
  descricao: string;
  valor: number;
  codigoTribNac?: string;
  codigoNbs?: string;
}

// Re-exportado daqui por compatibilidade (era definido neste arquivo).
export { ErroEmissaoNfse };

export interface ResultadoEmissaoNfse {
  sucesso: boolean;
  ambiente: string;
  numeroDpsUsado: number;
  idDps: string;
  emissaoId: string;
  chaveAcesso: string | null;
  calculoSimplesNacional: ResultadoCalculoSimples;
  resultadoEnvio: ResultadoEnvioDps;
}

/**
 * Emite uma NFS-e pro médico informado, buscando a empresa emissora
 * dele no banco. Lança ErroEmissaoNfse pra problemas esperados (sem
 * empresa cadastrada, campos faltando) — o chamador decide como tratar.
 *
 * Em caso de falha de REDE (sem resposta do governo), lança um erro
 * comum (não ErroEmissaoNfse) com a emissaoId anexada em
 * `error.emissaoId`, pra o chamador poder orientar a conferir o status
 * antes de tentar de novo (nunca reenviar automaticamente nesse caso).
 */
export async function emitirNfseParaMedico(
  medicoId: string,
  tomador: DadosTomadorEmissao,
  servico: DadosServicoEmissao,
  dataCompetencia: string
): Promise<ResultadoEmissaoNfse> {
  const empresaResult = await pool.query(
    `SELECT * FROM empresas_emissoras WHERE medico_id = $1`,
    [medicoId]
  );

  if (empresaResult.rows.length === 0) {
    throw new ErroEmissaoNfse(
      "Nenhuma empresa emissora cadastrada para este médico. Cadastre em POST /empresas-emissoras/me antes de emitir."
    );
  }

  const empresa = empresaResult.rows[0];

  // Certificado + ambiente da PRÓPRIA empresa (validados: CNPJ do
  // certificado bate, não está vencido, produção só com trava liberada).
  // Feito antes de reservar número, pra não "queimar" número à toa.
  const contexto = obterContextoEmissao(empresa);

  if (
    !tomador.codigoMunicipioIbge ||
    !tomador.cep ||
    !tomador.logradouro ||
    !tomador.numero ||
    !tomador.bairro
  ) {
    throw new ErroEmissaoNfse(
      "O hospital/tomador não tem endereço completo cadastrado (falta logradouro, número, bairro, CEP ou código do município). Edite o cadastro desse hospital (refazendo a busca por CNPJ) antes de emitir automaticamente."
    );
  }

  const serie = "1";

  const proximoNumero = await obterProximoNumeroDps(
    empresa.cnpj,
    serie,
    contexto.ambiente
  );

  const emissaoInsert = await pool.query(
    `INSERT INTO nfse_emissoes (
       medico_id, cnpj_prestador, serie, numero_dps, ambiente,
       status, tomador_documento, tomador_json, servico_json,
       data_competencia, valor
     )
     VALUES ($1,$2,$3,$4,$5,'pendente',$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      medicoId,
      empresa.cnpj,
      serie,
      String(proximoNumero),
      contexto.ambiente,
      tomador.cnpj ?? tomador.cpf,
      JSON.stringify(tomador),
      JSON.stringify(servico),
      dataCompetencia,
      Number(servico.valor),
    ]
  );
  const emissaoId: string = emissaoInsert.rows[0].id;

  const calculoSimples = await calcularPercentualSimplesNacional(
    empresa.id,
    new Date(dataCompetencia + "T12:00:00")
  );

  const xmlDps = montarDpsXml({
    ambiente: contexto.ambiente,
    dataHoraEmissao: dataHoraAtualBrasilia(),
    serie,
    numeroDps: String(proximoNumero),
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
    tomador: {
      cnpj: tomador.cnpj,
      cpf: tomador.cpf,
      razaoSocial: tomador.razaoSocial,
      codigoMunicipioIbge: tomador.codigoMunicipioIbge,
      cep: tomador.cep,
      logradouro: tomador.logradouro,
      numero: tomador.numero,
      complemento: tomador.complemento,
      bairro: tomador.bairro,
      telefone: tomador.telefone,
      email: tomador.email,
    },
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

  let resultadoEnvio: ResultadoEnvioDps;
  try {
    resultadoEnvio = await enviarDpsParaSefin(xmlAssinado, {
      certificado: contexto.certificado,
      ambiente: contexto.ambiente,
    });
  } catch (erroEnvio: any) {
    await pool.query(
      `UPDATE nfse_emissoes SET status = 'indeterminado', erro_mensagem = $1, updated_at = now() WHERE id = $2`,
      [erroEnvio?.message ?? "Erro de rede desconhecido", emissaoId]
    );
    const erro: any = new Error(
      "A chamada pro governo falhou antes de receber resposta — não sabemos se a nota foi processada. NÃO tente emitir de novo automaticamente. Confira o status dessa emissão antes de decidir o que fazer."
    );
    erro.emissaoId = emissaoId;
    throw erro;
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
      emissaoId,
    ]
  );

  if (sucesso) {
    await registrarFaturamentoAutomatico(
      empresa.id,
      dataCompetencia,
      Number(servico.valor)
    );
  }

  return {
    sucesso,
    ambiente: contexto.ambiente,
    numeroDpsUsado: proximoNumero,
    idDps: idElemento,
    emissaoId,
    chaveAcesso,
    calculoSimplesNacional: calculoSimples,
    resultadoEnvio,
  };
}
