# App Médicos — Mobile (Protótipo / Fase 2)

Escopo desta entrega: tela de **login** + **lista de plantões**, consumindo
a API do backend. Incluí também uma tela simples de "novo plantão", já que
o backend expõe o endpoint de criação e isso ajuda a testar o fluxo completo.

## Pré-requisitos

- Node.js 18+
- App **Expo Go** no celular (ou emulador Android/iOS configurado)
- Backend rodando (veja `../backend/README.md`)

## Como rodar

```bash
npm install
npm start
```
# deu erro por isso estamos usando

set REACT_NATIVE_PACKAGER_HOSTNAME=SEU_IP_LOCAL
npx expo start --lan

Isso abre o Metro Bundler com um QR Code. Escaneie com o Expo Go (Android)
ou a câmera (iOS) para abrir o app no celular.

## Importante: endereço da API

Em `src/api.ts` a constante `API_BASE_URL` está como `http://localhost:3000`.
Isso funciona no simulador iOS, mas **não** funciona direto em:

- **Emulador Android:** troque para `http://10.0.2.2:3000`.
- **Celular físico (Expo Go):** troque para o IP da sua máquina na rede
  local, ex: `http://192.168.0.10:3000` (rode `ipconfig`/`ifconfig` para
  descobrir).

## Login de teste

Use o usuário já cadastrado no `init.sql` do backend:

- **email:** `medico@exemplo.com`
- **senha:** a que você definir ao criar o médico

## Estrutura

```
App.tsx                    -> navegação (Login -> Plantões -> Novo Plantão)
screens/LoginScreen.tsx
screens/PlantoesScreen.tsx
screens/NovoPlantaoScreen.tsx
src/api.ts                 -> cliente axios + funções de API
src/statusPlantao.ts       -> cores/labels dos status (conforme documento)
```

## O que fica para depois

- 2FA no login.
- Calendário visual (hoje a lista é simples, sem view de calendário).
- Edição/cancelamento de plantão pela tela.
- Push notifications (Sprint 9 do cronograma).
