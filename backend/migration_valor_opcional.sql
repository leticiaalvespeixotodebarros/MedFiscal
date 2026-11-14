-- migration_valor_opcional.sql
--
-- Rode uma vez no banco existente (o init.sql só roda em banco novo).

ALTER TABLE plantoes ALTER COLUMN valor DROP NOT NULL;
