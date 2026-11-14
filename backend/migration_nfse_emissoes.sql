-- migration_nfse_emissoes.sql
--
-- Rode uma vez no banco existente.
--
-- Guarda cada tentativa de emissão de NFS-e, com o número da DPS
-- RESERVADO antes de qualquer chamada pro governo. Isso permite, se uma
-- emissão falhar no meio do caminho (timeout, queda de conexão, etc.),
-- reenviar reaproveitando o MESMO número em vez de gerar um novo — o que
-- evitaria duplicar uma nota fiscal real caso o governo já tivesse
-- processado a original e só a resposta tenha se perdido.

CREATE TABLE IF NOT EXISTS nfse_emissoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id UUID NOT NULL REFERENCES users(id),
  cnpj_prestador VARCHAR(14) NOT NULL,
  serie VARCHAR(5) NOT NULL,
  numero_dps VARCHAR(20) NOT NULL,
  ambiente VARCHAR(20) NOT NULL,
  -- 'pendente' = reservado, ainda não temos confirmação do governo
  -- 'sucesso'  = confirmado, tem chave de acesso
  -- 'erro'     = o governo respondeu recusando (seguro reenviar com o
  --              mesmo número, já que a rejeição foi confirmada)
  -- 'indeterminado' = a chamada falhou antes de receber resposta (rede
  --              caiu, timeout) — NÃO reenviar sem antes verificar
  --              manualmente se a nota foi processada do lado do governo
  status VARCHAR(20) NOT NULL DEFAULT 'pendente',
  chave_acesso VARCHAR(60),
  tomador_documento VARCHAR(14) NOT NULL,
  tomador_json JSONB NOT NULL,
  servico_json JSONB NOT NULL,
  data_competencia DATE NOT NULL,
  valor NUMERIC(12,2) NOT NULL,
  resposta_governo JSONB,
  erro_mensagem TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cnpj_prestador, serie, numero_dps, ambiente)
);

CREATE INDEX IF NOT EXISTS idx_nfse_emissoes_medico ON nfse_emissoes(medico_id);
