# MedFiscal — instruções para o Claude Code

App de gestão de plantões médicos com emissão automática de NFS-e pelo
Emissor Nacional. Responder sempre em **português do Brasil**.

**Leia também `CONTEXTO-MEDFISCAL.md`** (decisões, regras do governo
descobertas errando, empresas de referência, armadilhas do ambiente) — é o
resumo de tudo o que já foi conversado sobre o projeto. Mantenha-o
atualizado quando aprender algo que valha pras próximas conversas.

**Erros: consulte `ERROS-E-SOLUCOES.md` ANTES de investigar qualquer erro.**
Ele lista as etapas do desenvolvimento e todo erro já resolvido (causa e
solução). Nunca resolver o mesmo erro duas vezes: se já está lá, aplique a
solução registrada. Todo erro novo entra nesse arquivo no mesmo momento em
que for resolvido. Se faltar contexto, perguntar à Letícia antes de gastar
tokens com tentativas.

## Como trabalhar neste projeto
- Implemente direto nos arquivos tudo o que der pra fazer sozinho; só
  chame a Letícia quando precisar que ela teste algo (app no emulador,
  decisão de negócio, senha/certificado).
- Rode você mesmo os comandos de terminal (npm, docker, tsc, curl) e leia
  a saída — não peça pra ela copiar resultados.
- Antes de encerrar uma tarefa: `npx tsc --noEmit -p .` em `backend/` e
  em `mobile/` (os dois devem ficar sem erros).
- Ao terminar uma sessão de trabalho, atualizar o `onde-pareiN.md` mais
  recente (hoje: `onde-parei9.md`) com o que mudou e o roteiro de teste.

## Regras de negócio que NÃO podem ser quebradas
- **Multi-tenant**: o app é para vários médicos/empresas. Nenhum dado de
  cliente fixo no código (use sempre uma empresa de teste).
- **Homologação é o padrão seguro.** Produção (nota com validade fiscal)
  só com `NFSE_PERMITIR_PRODUCAO=true` no `.env` E a empresa com
  `ambiente = producao`. Nunca inverter esse padrão.
- O percentual do Simples Nacional é **calculado pelo sistema**
  (`src/nfse/simples-nacional.ts`), nunca perguntado à médica.
- Certificados (.pfx), senhas e o `.env` nunca vão pro Git nem pra
  chat/logs. Senhas de certificado são digitadas na tela dos scripts
  (entrada oculta) — nunca pedir pra Letícia colar senha numa conversa. Certificados das empresas ficam cifrados no banco
  (`NFSE_CHAVE_MESTRA` — nunca trocar depois de cadastrar certificados).
- Prazo de cancelamento de NF (45 dias) ainda precisa de confirmação do
  contador — não "corrigir" sem ela pedir.

## Estrutura
- `backend/` — Node.js + TypeScript + Express + PostgreSQL (Docker, porta 5433)
  - `src/nfse/` — integração com o governo: `dps.ts` (XML), `assinatura.ts`,
    `envio.ts`, `emitirNfse.ts` (emissão), `cancelamento.ts` (evento e101101),
    `certificado.ts` / `certificadoEmpresa.ts` (certificado por empresa +
    travas), `distribuicaoAdn.ts` (leitura das notas no ADN por NSU),
    `convenio.ts`, `simples-nacional.ts`, `numeracao.ts`
  - `src/tomadores/importacao.ts` — importa hospitais das notas emitidas
  - migrações: `backend/migration_*.sql`, rodadas por `npm run migrar`
    (lista em `scripts/migrar.ts`; toda migração nova entra lá e deve
    ser idempotente — `IF NOT EXISTS`)
- `mobile/` — React Native + Expo SDK 57. Endereço da API em
  `mobile/.env` (`EXPO_PUBLIC_API_URL`; emulador = `http://10.0.2.2:3000`).

## Comandos
```
# banco (o Docker Desktop precisa estar aberto)
cd backend && docker compose up -d
npm run migrar
npm run dev                       # API em http://localhost:3000

npm run criar-medico -- <email> "<nome>" <cpf>        # login de um médico (pede a senha na tela)
npm run cadastrar-empresa -- <email> <cnpj> [--im N]    # empresa emissora a partir do CNPJ
npm run cadastrar-certificado -- <email> "<.pfx>"      # pede a senha escondida; já importa os hospitais
npm run importar-hospitais -- <email>

# app (emulador Android do Android Studio ligado)
cd mobile && npx expo start --clear   # depois tecla "a"
```
Login: crie um médico de teste com `npm run criar-medico`
(token: `POST /auth/login` com `{"email","senha"}`).

## Pendências conhecidas
Ver o topo de `onde-parei9.md` (o que está aguardando teste) e o
checklist geral no fim dele.
