-- migration_historico.sql
--
-- Rode este script uma vez no banco que já existe (mesmo motivo das
-- migrações anteriores: init.sql só roda em banco novo).

CREATE TABLE IF NOT EXISTS plantoes_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plantao_id UUID NOT NULL REFERENCES plantoes(id) ON DELETE CASCADE,
  medico_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campo VARCHAR(20) NOT NULL, -- 'data' | 'horario' | 'hospital' | 'valor'
  valor_anterior TEXT,
  valor_novo TEXT,
  editado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plantoes_historico_plantao_id
  ON plantoes_historico(plantao_id);
