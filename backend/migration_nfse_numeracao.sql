-- migration_nfse_numeracao.sql
--
-- Rode uma vez no banco existente.
--
-- Controla o número sequencial da DPS por prestador + série + ambiente
-- (homologação e produção NÃO compartilham numeração — cada um conta
-- separado, senão a DPS de teste em homologação "gasta" números que
-- fariam falta na produção de verdade).

CREATE TABLE IF NOT EXISTS nfse_numeracao_dps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj_prestador VARCHAR(14) NOT NULL,
  serie VARCHAR(5) NOT NULL,
  ambiente VARCHAR(20) NOT NULL,
  ultimo_numero BIGINT NOT NULL DEFAULT 0,
  UNIQUE (cnpj_prestador, serie, ambiente)
);
