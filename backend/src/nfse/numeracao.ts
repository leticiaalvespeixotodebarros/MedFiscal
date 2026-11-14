import { pool } from "../db";

/**
 * Retorna o próximo número sequencial da DPS pra esse
 * prestador+série+ambiente, já incrementando e salvando no banco de
 * forma atômica (segura mesmo se duas emissões acontecerem ao mesmo
 * tempo — o UPSERT garante que não existe condição de corrida).
 *
 * Homologação e Produção têm numeração SEPARADA de propósito — testar
 * em homologação não pode "gastar" números que fariam falta na
 * produção de verdade.
 */
export async function obterProximoNumeroDps(
  cnpjPrestador: string,
  serie: string,
  ambiente: "homologacao" | "producao"
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO nfse_numeracao_dps (cnpj_prestador, serie, ambiente, ultimo_numero)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (cnpj_prestador, serie, ambiente)
     DO UPDATE SET ultimo_numero = nfse_numeracao_dps.ultimo_numero + 1
     RETURNING ultimo_numero`,
    [cnpjPrestador, serie, ambiente]
  );

  return Number(result.rows[0].ultimo_numero);
}
