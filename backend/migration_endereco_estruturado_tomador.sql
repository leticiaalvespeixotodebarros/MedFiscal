-- migration_endereco_estruturado_tomador.sql
--
-- Rode uma vez no banco existente.
--
-- O cadastro de hospital/tomador só guardava o endereço como um texto
-- único (bom pra exibir, ruim pra montar a DPS, que exige campos
-- separados). Isso adiciona os campos estruturados por trás — a tela
-- continua mostrando só um campo de endereço pra usuária, mas o app
-- passa a guardar os dados que a BrasilAPI já devolve estruturados, e
-- busca o código IBGE do município junto (via ViaCEP).

ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS logradouro VARCHAR(200);
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS numero VARCHAR(20);
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS complemento VARCHAR(100);
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS bairro VARCHAR(100);
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS cep VARCHAR(8);
ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS codigo_municipio_ibge VARCHAR(7);

-- Guarda a chave de acesso da NFS-e real emitida pra esse plantão (uma
-- vez que a emissão automática de verdade for feita, não mais o atalho
-- manual de status).
ALTER TABLE plantoes ADD COLUMN IF NOT EXISTS nfse_chave_acesso VARCHAR(60);
