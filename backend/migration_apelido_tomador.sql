-- migration_apelido_tomador.sql
--
-- Rode uma vez no banco existente (o init.sql só roda em banco novo).

ALTER TABLE tomadores ADD COLUMN IF NOT EXISTS apelido VARCHAR(100);
