-- Habilita geração de UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tabela de médicos (usuários)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(150) NOT NULL,
  cpf VARCHAR(14) NOT NULL UNIQUE,
  cnpj VARCHAR(18),
  email VARCHAR(150) NOT NULL UNIQUE,
  telefone VARCHAR(20),
  senha_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enum de status do plantão (reflete os estados visuais do documento)
DO $$ BEGIN
  CREATE TYPE plantao_status AS ENUM (
    'agendado',                    -- amarelo
    'nf_emitida',                  -- azul
    'nf_confirmada',               -- verde
    'aguardando_nova_data',        -- roxo
    'cancelamento_administrativo', -- vermelho
    'cancelado'                    -- cinza
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tabela de plantões
CREATE TABLE IF NOT EXISTS plantoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  horario VARCHAR(20) NOT NULL,
  hospital VARCHAR(150) NOT NULL,
  valor NUMERIC(10, 2) NOT NULL,
  descricao_nf TEXT,
  status plantao_status NOT NULL DEFAULT 'agendado',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plantoes_medico_id ON plantoes(medico_id);
CREATE INDEX IF NOT EXISTS idx_plantoes_data ON plantoes(data);

-- Para criar um médico de teste: npm run criar-medico -- <email> "<nome>" <cpf>
