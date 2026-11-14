-- migration_tomadores.sql
--
-- Este script precisa ser rodado UMA VEZ no banco que já existe (o
-- init.sql só roda sozinho na primeira vez que o container Postgres é
-- criado do zero — como seu banco já existe, ele não vai pegar essa
-- mudança automaticamente).

-- Tabela de tomadores (hospitais/clínicas que tomam a nota fiscal),
-- cadastrados por médico.
CREATE TABLE IF NOT EXISTS tomadores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cnpj VARCHAR(18) NOT NULL,
  razao_social VARCHAR(200) NOT NULL,
  endereco VARCHAR(255),
  email VARCHAR(150),
  telefone VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (medico_id, cnpj)
);

CREATE INDEX IF NOT EXISTS idx_tomadores_medico_id ON tomadores(medico_id);

-- Liga cada plantão a um tomador cadastrado (mantém a coluna "hospital"
-- de texto por compatibilidade com os plantões antigos e para exibição).
ALTER TABLE plantoes ADD COLUMN IF NOT EXISTS tomador_id UUID REFERENCES tomadores(id);
