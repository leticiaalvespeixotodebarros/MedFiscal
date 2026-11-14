-- migration_simples_nacional_calculo.sql
--
-- Rode uma vez no banco existente.
--
-- Guarda o faturamento e a folha de pagamento mês a mês de cada empresa
-- emissora, pra calcular automaticamente o RBT12 (receita bruta dos
-- últimos 12 meses) e o Fator R (folha / RBT12), e assim descobrir a
-- alíquota efetiva real do Simples Nacional a cada emissão — sem
-- precisar perguntar isso pra médica toda vez, como ela pediu.

CREATE TABLE IF NOT EXISTS faturamento_mensal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_emissora_id UUID NOT NULL REFERENCES empresas_emissoras(id),
  ano INT NOT NULL,
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- 'manual' = digitado por alguém (ex: meses anteriores a usar o app)
  -- 'automatico' = somado sozinho quando uma NFS-e é emitida com sucesso
  origem VARCHAR(20) NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_emissora_id, ano, mes)
);

CREATE TABLE IF NOT EXISTS folha_pagamento_mensal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_emissora_id UUID NOT NULL REFERENCES empresas_emissoras(id),
  ano INT NOT NULL,
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  -- Valor da folha de pagamento do mês, incluindo pró-labore e encargos
  -- (é assim que a lei define a base do Fator R) — hoje só entra manual,
  -- já que o app não tem folha de pagamento automatizada.
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_emissora_id, ano, mes)
);
