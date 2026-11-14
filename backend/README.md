# App Médicos — Backend (Protótipo / Fase 2)

Escopo desta entrega (conforme "Fase 2: Prototipação" do documento de arquitetura):

- API REST com autenticação (login/senha, sem 2FA ainda).
- 2 endpoints principais: **criar plantão** e **listar plantões**.
- Banco: PostgreSQL local via Docker.

## Como rodar

### 1. Subir o banco de dados

```bash
docker compose up -d
```

Isso cria o Postgres já com as tabelas `users` e `plantoes` (ver `init.sql`)
e insere um médico de teste:

- **email:** `medico@exemplo.com` (crie com `npm run criar-medico`)
- **senha:** a que você definir ao criar o médico

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Os valores padrão já batem com o `docker-compose.yml`. Ajuste `JWT_SECRET`
antes de qualquer uso além do ambiente local.

### 3. Instalar dependências e subir a API

```bash
npm install
npm run dev
```

A API sobe em `http://localhost:3000`.

## Testando os endpoints

**Login:**

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"medico@exemplo.com","senha":"<sua senha de teste>"}'
```

Copie o `token` retornado para os próximos passos.

**Criar plantão:**

```bash
curl -X POST http://localhost:3000/plantoes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -d '{
    "data": "2026-08-15",
    "horario": "19:00",
    "hospital": "Hospital Exemplo",
    "valor": 1200.00,
    "descricao_nf": "Plantão noturno - pronto-socorro"
  }'
```

**Listar plantões:**

```bash
curl http://localhost:3000/plantoes \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

## O que fica para as próximas sprints (fora do escopo deste protótipo)

- 2FA no login.
- Cadastro de novo médico via API (hoje só existe o usuário seed).
- Emissão automática de NF via Integra Contador.
- Editar/cancelar plantão, transições de status.
- Multi-tenancy formal (aqui o isolamento já existe via `medico_id`,
  mas ainda não há conceito de tenant/empresa separado do médico).

## Notas de segurança

Este é um protótipo local. Antes de qualquer ambiente real:

- Trocar `JWT_SECRET` por um valor forte e mantê-lo fora do repositório.
- Trocar a senha do Postgres definida no `docker-compose.yml`.
- Adicionar rate limiting no `/auth/login`.
- Adicionar validação de payload mais rigorosa (ex.: `zod` ou `class-validator`).
