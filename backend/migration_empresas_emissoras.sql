-- migration_empresas_emissoras.sql
--
-- Rode uma vez no banco existente.
--
-- Guarda os dados fiscais do PRESTADOR (a empresa que emite a NFS-e),
-- um registro por médico. Até agora esses dados estavam fixos no código
-- (uma empresa fixa no código) — isso corrige isso: cada
-- médico(a) cadastrado no app pode ter sua própria empresa emissora.

CREATE TABLE IF NOT EXISTS empresas_emissoras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id UUID NOT NULL UNIQUE REFERENCES users(id),
  cnpj VARCHAR(14) NOT NULL,
  razao_social VARCHAR(200) NOT NULL,
  inscricao_municipal VARCHAR(30), -- opcional: alguns municípios rejeitam se enviada (ver E0120)
  codigo_municipio_ibge VARCHAR(7) NOT NULL,
  cep VARCHAR(8) NOT NULL,
  logradouro VARCHAR(200) NOT NULL,
  numero VARCHAR(20) NOT NULL,
  complemento VARCHAR(100),
  bairro VARCHAR(100) NOT NULL,
  telefone VARCHAR(20),
  email VARCHAR(150),
  op_simp_nac SMALLINT NOT NULL DEFAULT 3, -- 1=Não optante, 2=MEI, 3=ME/EPP Simples
  reg_ap_trib_sn SMALLINT NOT NULL DEFAULT 1,
  -- Percentual aproximado de tributos do Simples Nacional (pTotTribSN).
  -- Por enquanto configurado manualmente por empresa — o cálculo
  -- automático (RBT12 + anexo + fator R) ainda é uma pendência registrada.
  percentual_aprox_tributos_sn NUMERIC(5,2) NOT NULL DEFAULT 0,
  codigo_trib_nac VARCHAR(6) NOT NULL, -- ex: "040101" para Medicina
  codigo_nbs VARCHAR(9),
  ambiente VARCHAR(20) NOT NULL DEFAULT 'homologacao', -- cada empresa pode estar em um estágio diferente
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
