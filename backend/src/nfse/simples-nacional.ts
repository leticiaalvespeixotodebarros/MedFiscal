/**
 * backend/src/nfse/simples-nacional.ts
 *
 * Calcula automaticamente a alíquota efetiva do Simples Nacional pra
 * cada empresa emissora, a cada emissão de NFS-e — sem precisar
 * perguntar isso pra médica, conforme pedido explicitamente por ela.
 *
 * Fórmula oficial (LC 123/2006, Art. 18):
 *   Alíquota efetiva = ((RBT12 × Alíquota nominal) − Parcela a deduzir) / RBT12
 *
 * Tabelas de Anexo III e Anexo V confirmadas direto na fonte oficial
 * (normas.receita.fazenda.gov.br) — são as duas que valem pra
 * "prestação de serviço" do inciso V do art. 18 (medicina, contabilidade,
 * publicidade, advocacia, TI, etc. — os 3 tipos de empresa já validados
 * no MedFiscal): usa Anexo III se o Fator R for >= 28%, senão Anexo V.
 *
 * Fator R = Folha de pagamento (12 meses, com pró-labore e encargos) / RBT12
 */

import { pool } from "../db";

interface FaixaSimples {
  limiteSuperior: number;
  aliquotaNominal: number; // ex: 0.06 = 6%
  parcelaDeduzir: number;
}

// Fonte: normas.receita.fazenda.gov.br (Anexo III e Anexo V da LC 123/2006)
const TABELA_ANEXO_III: FaixaSimples[] = [
  { limiteSuperior: 180_000, aliquotaNominal: 0.06, parcelaDeduzir: 0 },
  { limiteSuperior: 360_000, aliquotaNominal: 0.112, parcelaDeduzir: 9_360 },
  { limiteSuperior: 720_000, aliquotaNominal: 0.135, parcelaDeduzir: 17_640 },
  { limiteSuperior: 1_800_000, aliquotaNominal: 0.16, parcelaDeduzir: 35_640 },
  { limiteSuperior: 3_600_000, aliquotaNominal: 0.21, parcelaDeduzir: 125_640 },
  { limiteSuperior: 4_800_000, aliquotaNominal: 0.33, parcelaDeduzir: 648_000 },
];

const TABELA_ANEXO_V: FaixaSimples[] = [
  { limiteSuperior: 180_000, aliquotaNominal: 0.155, parcelaDeduzir: 0 },
  { limiteSuperior: 360_000, aliquotaNominal: 0.18, parcelaDeduzir: 4_500 },
  { limiteSuperior: 720_000, aliquotaNominal: 0.195, parcelaDeduzir: 9_900 },
  { limiteSuperior: 1_800_000, aliquotaNominal: 0.205, parcelaDeduzir: 17_100 },
  { limiteSuperior: 3_600_000, aliquotaNominal: 0.23, parcelaDeduzir: 62_100 },
  { limiteSuperior: 4_800_000, aliquotaNominal: 0.305, parcelaDeduzir: 540_000 },
];

function buscarFaixa(rbt12: number, tabela: FaixaSimples[]): FaixaSimples {
  for (const faixa of tabela) {
    if (rbt12 <= faixa.limiteSuperior) return faixa;
  }
  // Acima de R$ 4,8 milhões: fora do Simples Nacional. Usa a última
  // faixa como aproximação — nesse caso o ideal é alertar a contadora,
  // já que a empresa provavelmente precisa ser desenquadrada.
  return tabela[tabela.length - 1];
}

/** As 12 competências (ano, mês) anteriores (inclusive) à data de referência. */
function ultimasDozeCompetencias(
  dataReferencia: Date
): { ano: number; mes: number }[] {
  const competencias: { ano: number; mes: number }[] = [];
  const d = new Date(dataReferencia.getFullYear(), dataReferencia.getMonth(), 1);
  for (let i = 0; i < 12; i++) {
    competencias.push({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
    d.setMonth(d.getMonth() - 1);
  }
  return competencias;
}

async function somarValoresDosUltimosDozeMeses(
  tabela: "faturamento_mensal" | "folha_pagamento_mensal",
  empresaId: string,
  dataReferencia: Date
): Promise<number> {
  const competencias = ultimasDozeCompetencias(dataReferencia);
  let total = 0;

  for (const { ano, mes } of competencias) {
    const result = await pool.query(
      `SELECT valor FROM ${tabela} WHERE empresa_emissora_id = $1 AND ano = $2 AND mes = $3`,
      [empresaId, ano, mes]
    );
    if (result.rows.length > 0) {
      total += Number(result.rows[0].valor);
    }
  }

  return total;
}

export interface ResultadoCalculoSimples {
  rbt12: number;
  folhaPagamento12Meses: number;
  fatorRPercentual: number;
  anexo: "III" | "V";
  aliquotaNominalPercentual: number;
  parcelaDeduzir: number;
  /** Alíquota efetiva final, em percentual (ex: 8.97 = 8,97%) — é isso
   * que vai no campo pTotTribSN da DPS. */
  aliquotaEfetivaPercentual: number;
  /** true se não havia faturamento suficiente pra calcular de verdade
   * (empresa nova no app, sem histórico ainda) — nesse caso o valor
   * retornado é uma aproximação conservadora, não o cálculo real. */
  semHistoricoSuficiente: boolean;
}

/**
 * Calcula a alíquota efetiva do Simples Nacional pra uma empresa
 * emissora, na data de referência informada (normalmente a data de
 * competência do serviço sendo faturado agora).
 */
export async function calcularPercentualSimplesNacional(
  empresaId: string,
  dataReferencia: Date = new Date()
): Promise<ResultadoCalculoSimples> {
  const rbt12 = await somarValoresDosUltimosDozeMeses(
    "faturamento_mensal",
    empresaId,
    dataReferencia
  );
  const folha = await somarValoresDosUltimosDozeMeses(
    "folha_pagamento_mensal",
    empresaId,
    dataReferencia
  );

  if (rbt12 <= 0) {
    // Empresa ainda sem histórico de faturamento no app (ex: acabou de
    // cadastrar) — não dá pra calcular de verdade. Usa a 1ª faixa do
    // Anexo V (mais conservadora, evita subestimar o imposto) como
    // ponto de partida até existir histórico suficiente.
    const faixa = TABELA_ANEXO_V[0];
    return {
      rbt12: 0,
      folhaPagamento12Meses: folha,
      fatorRPercentual: 0,
      anexo: "V",
      aliquotaNominalPercentual: faixa.aliquotaNominal * 100,
      parcelaDeduzir: faixa.parcelaDeduzir,
      aliquotaEfetivaPercentual: faixa.aliquotaNominal * 100,
      semHistoricoSuficiente: true,
    };
  }

  const fatorR = folha / rbt12;
  const anexo: "III" | "V" = fatorR >= 0.28 ? "III" : "V";
  const tabela = anexo === "III" ? TABELA_ANEXO_III : TABELA_ANEXO_V;
  const faixa = buscarFaixa(rbt12, tabela);

  const aliquotaEfetiva =
    ((rbt12 * faixa.aliquotaNominal - faixa.parcelaDeduzir) / rbt12) * 100;

  return {
    rbt12,
    folhaPagamento12Meses: folha,
    fatorRPercentual: fatorR * 100,
    anexo,
    aliquotaNominalPercentual: faixa.aliquotaNominal * 100,
    parcelaDeduzir: faixa.parcelaDeduzir,
    aliquotaEfetivaPercentual: Math.max(aliquotaEfetiva, 0),
    semHistoricoSuficiente: false,
  };
}

/**
 * Registra (somando) um valor faturado na competência informada —
 * chamado automaticamente depois de uma NFS-e emitida com SUCESSO, pra
 * manter o RBT12 sempre atualizado sozinho, sem esforço manual.
 */
export async function registrarFaturamentoAutomatico(
  empresaId: string,
  dataCompetencia: string, // "AAAA-MM-DD"
  valor: number
): Promise<void> {
  const [anoStr, mesStr] = dataCompetencia.split("-");
  const ano = Number(anoStr);
  const mes = Number(mesStr);

  await pool.query(
    `INSERT INTO faturamento_mensal (empresa_emissora_id, ano, mes, valor, origem)
     VALUES ($1, $2, $3, $4, 'automatico')
     ON CONFLICT (empresa_emissora_id, ano, mes)
     DO UPDATE SET valor = faturamento_mensal.valor + $4, updated_at = now()`,
    [empresaId, ano, mes, valor]
  );
}
