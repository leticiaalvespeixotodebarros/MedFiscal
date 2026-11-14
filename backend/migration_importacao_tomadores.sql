-- migration_importacao_tomadores.sql
--
-- Rode uma vez no banco existente (ou só: npm run migrar).
--
-- Importação automática de hospitais (tomadores) a partir das NFS-e que
-- a empresa do médico já emitiu (últimos 24 meses ou desde a abertura).

-- Origem e uso de cada hospital cadastrado.
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS origem VARCHAR(30) NOT NULL DEFAULT 'manual'; -- 'manual' | 'importado_nfse'
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS ultima_nota_em DATE;
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS qtd_notas_importadas INT NOT NULL DEFAULT 0;
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS municipio VARCHAR(100);
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS uf VARCHAR(2);
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS inscricao_municipal VARCHAR(30);

-- Retomada incremental da leitura das notas no ADN (fila por NSU) e data
-- de abertura da empresa (limita o período de busca).
ALTER TABLE empresas_emissoras ADD COLUMN IF NOT EXISTS importacao_nsu_proximo BIGINT NOT NULL DEFAULT 0;
ALTER TABLE empresas_emissoras ADD COLUMN IF NOT EXISTS data_abertura DATE;

-- Histórico/estado de cada importação (roda em segundo plano).
CREATE TABLE IF NOT EXISTS importacoes_tomadores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'executando', -- executando | concluida | parcial | erro
  motivo VARCHAR(40), -- 'manual' | 'certificado_cadastrado' | 'script'
  periodo_inicio DATE,
  nsu_inicial BIGINT,
  nsu_atual BIGINT,
  documentos_lidos INT NOT NULL DEFAULT 0,
  notas_emitidas_periodo INT NOT NULL DEFAULT 0,
  notas_canceladas INT NOT NULL DEFAULT 0,
  tomadores_novos INT NOT NULL DEFAULT 0,
  tomadores_atualizados INT NOT NULL DEFAULT 0,
  ignorados_pessoa_fisica INT NOT NULL DEFAULT 0,
  mensagem TEXT,
  iniciado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_importacoes_tomadores_medico ON importacoes_tomadores(medico_id, iniciado_em DESC);
