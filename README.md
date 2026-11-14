# MedFiscal

Aplicativo de gestão de plantões médicos que **emite NFS-e automaticamente**
pelo Emissor Nacional (padrão nacional de NFS-e do governo federal).
Projeto de portfólio, em desenvolvimento; as integrações com o governo foram
testadas no ambiente de **homologação**.

> **LGPD:** este repositório não contém dados de clientes, certificados
> digitais, senhas nem arquivos `.env`. Todos os exemplos usam dados fictícios.

## O que o projeto faz

- Agenda de plantões (lista e calendário), com valor opcional e cobrança do valor pendente.
- Cadastro de hospitais (tomadores) por CNPJ (BrasilAPI e ViaCEP) ou importação a partir das notas já emitidas.
- Emissão de NFS-e: monta a DPS (XML), assina (XMLDSig), envia ao Sefin Nacional com mTLS usando o certificado A1 da própria empresa.
- Cancelamento de NFS-e (evento e101101) e estorno do faturamento.
- Cálculo automático da alíquota efetiva do Simples Nacional (Anexos III e V, Fator R, RBT12), sem perguntar ao usuário.
- Multi-tenant: cada médico tem sua empresa emissora e seu certificado, guardado cifrado (AES-256-GCM).
- Proteção contra nota duplicada (número da DPS reservado antes do envio) e trava de segurança: produção só com autorização explícita.

## Stack

- **Backend:** Node.js, TypeScript, Express, PostgreSQL (Docker), JWT.
- **Mobile:** React Native com Expo (SDK 57), TypeScript.

## Estrutura

- `backend/src/nfse/`: integração com o governo (DPS, assinatura, envio, cancelamento, Simples Nacional).
- `backend/src/tomadores/`: hospitais e importação das notas.
- `backend/migration_*.sql`: migrações idempotentes (`npm run migrar`).
- `mobile/`: telas e cliente da API.
- `ERROS-E-SOLUCOES.md`: cronologia do desenvolvimento e erros já resolvidos (versão anonimizada).

## Como rodar localmente

1. `cd backend && docker compose up -d`
2. `cp .env.example .env` e preencha (nunca versione o `.env`); `npm install && npm run migrar && npm run dev`
3. Crie um médico de teste: `npm run criar-medico -- medico@exemplo.com "Nome do Médico" 00000000000`
4. `cd mobile && npm install && npx expo start --clear`. Ajuste `EXPO_PUBLIC_API_URL` conforme o ambiente (emulador Android: `http://10.0.2.2:3000`).
