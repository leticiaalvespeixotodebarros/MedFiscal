-- migration_nao_realizado.sql
--
-- Rode uma vez no banco existente (o init.sql só roda em banco novo).

ALTER TABLE plantoes ADD COLUMN IF NOT EXISTS data_emissao_nf DATE;
ALTER TABLE plantoes ADD COLUMN IF NOT EXISTS observacao_cancelamento TEXT;
