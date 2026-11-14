-- migration_certificado_empresa.sql
--
-- Rode uma vez no banco existente.
--
-- Certificado A1 (.pfx) próprio de cada empresa emissora, guardado
-- CIFRADO (AES-256-GCM, chave mestra NFSE_CHAVE_MESTRA no .env). Sem
-- isso, todas as empresas usavam o mesmo certificado do .env.

ALTER TABLE empresas_emissoras ADD COLUMN IF NOT EXISTS certificado_pfx_cifrado TEXT;
ALTER TABLE empresas_emissoras ADD COLUMN IF NOT EXISTS certificado_senha_cifrada TEXT;
ALTER TABLE empresas_emissoras ADD COLUMN IF NOT EXISTS certificado_titular VARCHAR(200);
ALTER TABLE empresas_emissoras ADD COLUMN IF NOT EXISTS certificado_validade TIMESTAMPTZ;

-- Cancelamento de NFS-e (evento e101101): guarda no histórico de
-- emissões quando/como a nota foi cancelada no governo.
ALTER TABLE nfse_emissoes ADD COLUMN IF NOT EXISTS cancelada_em TIMESTAMPTZ;
ALTER TABLE nfse_emissoes ADD COLUMN IF NOT EXISTS cancelamento_motivo TEXT;
ALTER TABLE nfse_emissoes ADD COLUMN IF NOT EXISTS cancelamento_resposta JSONB;
