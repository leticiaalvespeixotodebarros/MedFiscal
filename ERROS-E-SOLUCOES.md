# MedFiscal — Etapas do desenvolvimento, erros e soluções

_Versão pública e anonimizada: nomes de empresas, médicos, clientes e cidades foram trocados por rótulos genéricos (LGPD)._

> **REGRA DO PROJETO: nunca resolver o mesmo erro duas vezes.**
> 1. Antes de investigar QUALQUER erro, procure aqui (Ctrl+F pelo código do
>    erro, pela mensagem ou pelo sintoma) e no `CONTEXTO-MEDFISCAL.md`.
> 2. Se o erro já está aqui, aplique a solução registrada. Não pesquise de novo.
> 3. Todo erro NOVO entra neste arquivo no mesmo momento em que for resolvido
>    (sintoma/código, causa, solução, arquivo, data). Erro ainda sem solução
>    entra em "Erros em aberto".
> 4. Se faltar contexto para entender um erro, pergunte à responsável pelo projeto antes de
>    gastar tokens com tentativas.
>
> Fontes desta primeira versão (14/11/2026): `onde-parei1.md` a
> `onde-parei9.md`, `CONTEXTO-MEDFISCAL.md`, `CLAUDE.md` e o histórico Git
> do `mobile/`. Nada aqui foi deduzido: só o que está registrado nessas fontes.
> Nunca registrar senhas, conteúdo de certificado ou do `.env` neste arquivo.

---

## 1. Cronologia das etapas

| Data | Etapa | Resultado |
|---|---|---|
| até 09/2026 (início) | Projeto movido para fora da pasta sincronizada do OneDrive, Docker Desktop instalado, backend com Postgres (porta trocada para 5433), API em `localhost:3000` | Login, criar e listar plantões testados por curl |
| início 09/2026 | Mobile: `npm install`, IP do PC no `api.ts`, Expo Go no celular | App abriu no celular após forçar o IP do Metro e instalar Expo Go SDK 51 |
| 05–06/09/2026 | Validação de data/hora (backend e app), máscara de moeda BR, formatação de datas, seletores de calendário/relógio, try/catch nas rotas de plantões | Testado e funcionando |
| 07/09/2026 | Git no `mobile/` + repositório GitHub privado; SDK 51 → 52 → 57 | `expo-doctor` 21/21, app funcionando no Expo Go da Play Store |
| 07/09/2026 | Seleção de hospital (tomadores) com busca por CNPJ (BrasilAPI); edição/exclusão de plantão (Regra 1) com histórico; try/catch no login; menu inicial e rebranding "MedFiscal"; calendário de plantões; apelido do hospital; valor desconhecido + popup de cobrança | Testados. Rotação de tela tentada e não funcionou |
| 07/09/2026 | Teste manual de emissão no Emissor Nacional (site) com o certificado de uma empresa de teste | Erro de cadastro não habilitado (ver seção Governo) |
| 13/09/2026 | Regras 2/3: "não realizado", cancelamento de NF (atalho manual), retificação do Simples; plantão retroativo; KeyboardAvoidingView (parcial) | Testados (com atalhos temporários) |
| 13/09/2026 | Emissor de NFS-e, fases 1–4: mTLS, DPS, numeração, assinatura, envio | **1ª NFS-e emitida em homologação** (empresa de teste A), após corrigir E1235, E0120 e E0712 |
| 24–25/09/2026 | Multi-tenant (`empresas_emissoras`), proteção contra duplicidade (`nfse_emissoes`), cálculo automático do Simples (Anexos III/V, Fator R), endereço estruturado + IBGE do tomador, botão de plantão emite de verdade; testes com empresas reais de teste | Funcionando em homologação; 2 bugs de segurança corrigidos |
| 25/09/2026 | Teste no celular físico bloqueado pela rede | Decisão: emulador Android (Android Studio, "Medium Phone") |
| 24/10/2026 | Certificado e ambiente por empresa (cifrado AES-256-GCM), travas de CNPJ/validade/produção, cancelamento real (e101101), consulta de convênio, tela Minha Empresa, "Emitir NF" no app, `mobile/.env`, correções de datas/fuso e do reenvio, `npm run migrar` | Compila (`tsc` limpo); aguardava teste |
| 26/10/2026 | Importação automática de hospitais das notas emitidas (ADN por NSU, porta de um baixador de notas em Python) | Testada pelo terminal: 2 hospitais importados das notas de uma empresa de teste |
| 26/10/2026 (noite) | Testes pelo terminal: migrações, certificado, emissão e cancelamento | E1235 por leiaute NT 009 corrigido (só homologação); **NFS-e nº 5 emitida e cancelada em homologação** |
| 14/11/2026 | Scripts `criar-medico`, `cadastrar-empresa`, `cadastrar-certificado` (senha oculta) para duas empresas de teste | Compilam; scripts que falam com banco/BrasilAPI ainda não rodados |
| 14/11/2026 | Criado este documento | — |

---

## 2. Erros e soluções por tema

### 2.1 Governo / NFS-e (Sefin, ADN, Emissor Nacional)

| Sintoma / código | Causa | Solução aplicada | Arquivo | Data |
|---|---|---|---|---|
| `E1235` no campo `dhEmi` | Data/hora com milissegundos e em UTC bruto | Horário de Brasília sem milissegundos (`dataHoraAtualBrasilia()`), com margem de 5 min no passado para não cair no E0008 | `backend/src/nfse/dps.ts` | 13/09/2026 |
| `E0008` (relógio) — prevenção, não chegou a ocorrer | Risco de horário de emissão "no futuro" em relação ao governo | A mesma margem de 5 min no passado no `dhEmi` | `backend/src/nfse/dps.ts` | 13/09/2026 |
| `E0120` "IM do prestador não deve ser informado" | O CNC de **homologação** do governo não tem a informação complementar (IM) do prestador | IM só vai na DPS em **produção**; em homologação é omitida sozinha (validado em dois municípios) | `backend/src/nfse/dps.ts` | 13/09 e 24–25/09/2026 |
| `E0712` "Para ME/EPP o indicador de valor total de tributos não pode ser informado" | `indTotTrib` é proibido para ME/EPP | ME/EPP usa `<totTrib><pTotTribSN>` com a alíquota efetiva calculada; MEI/não optante usa `indTotTrib=0` | `backend/src/nfse/dps.ts` | 13/09 e 24/10/2026 |
| `E1235` em `trib`/`totTrib` | `totTrib` não pode ficar vazio | `pTotTribSN` para ME/EPP; `indTotTrib=0` para MEI/não optante. `regApTribSN` só para ME/EPP optante (`opSimpNac=3`) | `backend/src/nfse/dps.ts` | 24/10/2026 |
| `E1235` (esquema) na emissão em homologação | Desde 20/10/2026 a produção restrita (Sefin 1.6.0) usa o leiaute da **NT 009** | Só em homologação: `<finNFSe>0</finNFSe>` entre `tpEmit` e `cLocEmi`, e `cNBS` antes de `xDescServ` no `cServ`. Produção segue o leiaute de 09/02/2026. ⚠️ Quando a NT 009 chegar em produção, tirar as condições | `backend/src/nfse/dps.ts` | 26/10/2026 |
| Dúvida: Id do cancelamento com ou sem sufixo `001` | Documentação não deixa claro | Id `PRE`+chave(50)+`101101` **sem** sufixo foi aceito de primeira; o código ainda tenta com `001` se o governo recusar por esquema | `backend/src/nfse/cancelamento.ts` | 26/10/2026 |
| Cancelamento: campo do JSON (regra conferida em XMLs de terceiros) | O evento não usa o mesmo campo da emissão | Enviar `pedidoRegistroEventoXmlGZipB64` (não `dpsXmlGZipB64`) em `POST {sefin}/nfse/{chave}/eventos` | `backend/src/nfse/cancelamento.ts` | 24/10/2026 |
| Site do Emissor Nacional: "o cadastro referente à inscrição [...] não foi encontrado ou não está habilitado para emissão de NFS-e, dentre os municípios conveniados" (empresa de teste, Emissão Completa) | Sincronização cadastral entre a inscrição municipal e o Ambiente Nacional (erro comum, não é restrição a ME/EPP) | Contatar a prefeitura (Secretaria Municipal de Finanças) para atualizar o vínculo. "Emissão Simplificada" é só para MEI; ME/EPP usa a "Emissão Completa" | — (fora do app) | 07/09/2026 |
| ADN: HTTP 404 na leitura por NSU | Fim da fila | Tratado como fim normal | `backend/src/nfse/distribuicaoAdn.ts` | 26/10/2026 |
| ADN: HTTP 429 | Limite de consultas | Espera e retoma pelo NSU salvo (`importacao_nsu_proximo`) | `backend/src/nfse/distribuicaoAdn.ts`, `src/tomadores/importacao.ts` | 26/10/2026 |
| ADN: consulta com procuração e-CAC não funciona | O ADN só aceita o certificado do próprio CNPJ | Usar o certificado da própria empresa | `backend/src/nfse/distribuicaoAdn.ts` | 26/10/2026 |
| Qual ADN ler na importação de hospitais (decisão) | As notas reais estão em produção | Importação lê o ADN de **produção** por padrão (consulta não tem efeito fiscal); `NFSE_IMPORTACAO_AMBIENTE=homologacao` para ler o de testes | `backend/src/tomadores/importacao.ts` | 26/10/2026 |
| Rede caiu sem resposta do governo durante a emissão | Não dá para saber se a nota foi emitida | Número da DPS reservado antes do envio; status `indeterminado`; **nunca reenviar sozinho**, conferir antes | `backend/src/nfse/emitirNfse.ts`, `nfse_emissoes` | 24–25/09/2026 |
| Reenvio (`/emissoes/:id/reenviar`) quebrava | Data vinda do banco como objeto `Date` | Corrigido; e agora recusa reenviar se a empresa mudou de ambiente | `backend/src/nfse/nfse.routes.ts` | 24/10/2026 |
| Risco de mandar XML de homologação para produção | URL do governo seguia `NFSE_AMBIENTE` global, não o ambiente da empresa | Ambiente e certificado por empresa; produção só com `NFSE_PERMITIR_PRODUCAO=true` **e** empresa em `producao` | `backend/src/nfse/certificadoEmpresa.ts` | 24/10/2026 |
| Fallback caía em "produção" quando a variável de ambiente falhava | Padrão inseguro | Padrão sempre homologação | `backend/src/nfse/certificado.ts` | 24–25/09/2026 |
| IM de uma empresa de teste sumiu do cadastro | Perdida numa edição no meio do caminho | Restaurada | rota de teste (removida desta cópia pública) | 24–25/09/2026 |
| Toque duplo em "Emitir NF" (prevenção) | Podia emitir duas notas para o mesmo plantão | Trava no app e no backend | `PlantoesScreen.tsx`, `plantoes.routes.ts` | 24/10/2026 |

### 2.2 Simples Nacional e datas fiscais

| Sintoma | Causa | Solução aplicada | Arquivo | Data |
|---|---|---|---|---|
| `pTotTribSN` fixo em 6% (teste) | Valor de protótipo | Alíquota efetiva calculada a cada emissão (Anexos III/V, Fator R, RBT12); sem histórico, 1ª faixa do Anexo V (15,5%). **Nunca perguntar à médica** | `backend/src/nfse/simples-nacional.ts` | 24–25/09/2026 |
| Competência do dia 1º caía no mês anterior; datas deslocadas | `toISOString()` em colunas DATE converte para UTC e muda o dia/mês | Trocado por `dataParaISO()` (calendário local) | backend (cálculo do Simples e rotas) | 24/10/2026 |

### 2.3 Banco de dados / backend

| Sintoma | Causa | Solução aplicada | Arquivo | Data |
|---|---|---|---|---|
| Postgres do Docker não subia na 5432 | Já havia um Postgres nativo do Windows usando a 5432 | Porta trocada para **5433** (`docker-compose.yml` e `DATABASE_URL` no `.env`). Não mexer de novo | `backend/docker-compose.yml`, `.env` | início 09/2026 |
| `ECONNREFUSED` na porta 5433 | Docker Desktop fechado (o backend sobe mesmo sem banco) | Abrir o Docker Desktop → `docker compose up -d` → `npm run migrar` | — | 24/10/2026 |
| Login falhava via curl | O campo é `senha`, não `password` | Corpo: `{"email":"…","senha":"…"}` | `backend/src/auth/auth.routes.ts` | início 09/2026 |
| `date/time field value out of range: "20261302"` e app mostrando "Não foi possível salvar o plantão" | Backend não validava data antes do insert | `validarData` e `validarHorario` antes do `pool.query`; resposta 400 com campo e mensagem | `backend/src/utils/validacao.ts`, `plantoes.routes.ts` | 05–06/09/2026 |
| Backend inteiro parava de responder depois de um erro do banco | `await pool.query` sem try/catch derrubava o processo | try/catch nas rotas de plantões (06/09) e no login (07/09). Rotas novas devem seguir o mesmo padrão | `plantoes.routes.ts`, `auth.routes.ts` | 06–07/09/2026 |
| Tabela/coluna inexistente depois de recriar o banco | `init.sql` só roda em banco novo; migrações eram manuais | `npm run migrar` roda todas as migrações na ordem (todas idempotentes, `IF NOT EXISTS`); toda migração nova entra em `scripts/migrar.ts` | `backend/scripts/migrar.ts` | 24/10/2026 |
| 6 erros de tipagem no backend | — (detalhes não registrados) | Corrigidos; `tsc --noEmit` limpo antes de encerrar | backend | 24/10/2026 |

### 2.4 Windows / npm / Node

| Sintoma | Causa | Solução aplicada | Arquivo | Data |
|---|---|---|---|---|
| `Unsupported PKCS12 PFX data` | OpenSSL 3 (Node recente) desativou a criptografia de PKCS12 antigos | `NODE_OPTIONS=--openssl-legacy-provider` (já nos scripts `dev` e `cadastrar-certificado`) | `backend/package.json` | 13/09/2026 |
| `xml-crypto`: `digestAlgorithm is required`, depois `Private key is required` | Versão instalada usa a API nova (construtor com `{privateKey, publicCert, …}` e `addReference` como objeto) | Código ajustado à API nova | `backend/src/nfse/assinatura.ts` | 13/09/2026 |
| Caminho com espaço chega "em pedaços" no script | O `npm` no Windows tira as aspas dos argumentos | Script remonta o caminho com espaços | `backend/scripts/cadastrar-certificado.ts`, `util-terminal.ts` | 14/11/2026 |
| Definir variável de ambiente no `cmd` (armadilha registrada) | Sintaxe do `cmd` | `set VAR=x && comando` | — | — |
| Acentuação corrompida (`M├®dicos`) no `app.json` | Arquivo salvo pelo Bloco de Notas com encoding errado | Corrigido; nome ficou sem acento para não repetir. Não editar arquivos do projeto pelo Bloco de Notas | `mobile/app.json` | 07/09/2026 |

### 2.5 Emulador, rede e celular

| Sintoma | Causa | Solução aplicada | Arquivo | Data |
|---|---|---|---|---|
| Expo Go abria `exp://127.0.0.1:8081` (modo localhost em vez de LAN) | Adaptador virtual do WSL confundia a detecção do IP | `set REACT_NATIVE_PACKAGER_HOSTNAME=<IP do PC>` + `npx expo start --lan` | — | início 09/2026 |
| "Failed to download remote update" no celular físico via Wi-Fi | Rede/roteador (provável isolamento de clientes); firewall do Node só liberado em rede "Pública" foi corrigido, mas não resolveu | **Usar o emulador Android** (Android Studio, "Medium Phone"). Modo túnel só resolve o Metro, não a API | — | 25/09/2026 |
| App no emulador não chega na API com `localhost` | Dentro do emulador, `localhost` é o próprio emulador | `mobile/.env` → `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`. Celular no Wi-Fi: IP do PC; cabo USB: `adb reverse` + localhost. Depois de mudar o `.env`: `npx expo start --clear` | `mobile/.env`, `mobile/src/api.ts` | 25/09 e 24/10/2026 |

### 2.6 Expo / mobile

| Sintoma | Causa | Solução aplicada | Arquivo | Data |
|---|---|---|---|---|
| Expo Go incompatível (celular SDK 57, projeto SDK 51) | Expo Go se atualizou sozinho pela Play Store | Provisório: APK do Expo Go SDK 51 (`expo.dev/go?sdkVersion=51…`). Definitivo: projeto atualizado para SDK 57 | — | 07/09/2026 |
| "Pacote parece ser inválido" ao instalar o APK do Expo Go | Android tratou como atualização com assinatura diferente | Desinstalar totalmente o Expo Go anterior antes | — | 07/09/2026 |
| `node_modules` corrompido no SDK 52 | Instalação quebrada | `rmdir node_modules` + `del package-lock.json` + `npm install` | `mobile/` | 07/09/2026 |
| Conflito de dependências no SDK 57 | `@react-navigation/native@6` não é compatível com React 19 / RN 0.86 | `@react-navigation/native` e `native-stack` na **v7** e `@types/react` na **v19** | `mobile/package.json` | 07/09/2026 |
| `expo-doctor` 20/21 | Propriedade `"splash"` obsoleta no `app.json` | Removida | `mobile/app.json` | 07/09/2026 |
| `babel-preset-expo` faltando; `@expo/vector-icons` sem achar as fontes `.ttf` | Pacotes instalados manualmente em vez de `expo install` | Limpeza completa + `npm install` + `npx expo install --fix` + `npx expo install expo-font`. Instalar pacotes Expo sempre com `npx expo install` | `mobile/package.json` | 07/09/2026 |
| Data crua na lista (`15T03:00:00.000Z/08/2026`) | Data do banco exibida sem formatar | Formatação `dd/mm/aaaa HH:mm` e helpers de data | `mobile/src/utils/dataHora.ts`, `PlantoesScreen.tsx` | 06/09/2026 |
| Aviso: `onChange` do datetimepicker depreciado | Versão nova da biblioteca | Ainda não trocado por `onValueChange` (só aviso) | `NovoPlantaoScreen.tsx` | 07/09/2026 |

### 2.7 Certificados

| Sintoma | Causa | Solução aplicada | Arquivo | Data |
|---|---|---|---|---|
| Certificado de uma empresa não exporta `.pfx` | Chave privada marcada como não exportável no Windows | Não serve para testes; usar outro certificado | — | 13/09/2026 |
| Todas as empresas usavam o certificado do `.env` | Arquitetura inicial | Certificado por empresa, cifrado no banco com `NFSE_CHAVE_MESTRA` (**nunca trocar a chave depois de cadastrar certificados**); travas: mesmo CNPJ, não vencido | `backend/src/nfse/certificadoEmpresa.ts` | 24/10/2026 |
| Senha do certificado passada como argumento do script (ficava no histórico do terminal) | Versão antiga do script recebia a senha na linha de comando | Scripts pedem a senha na tela, oculta. Nunca senha em chat, `.env` ou Git | `backend/scripts/cadastrar-certificado.ts` | 14/11/2026 |

### 2.8 Git

| Sintoma | Causa | Solução aplicada | Data |
|---|---|---|---|
| `node_modules` e `.expo` commitados; `.gitignore` mal formatado duas vezes | Erros de digitação/colagem | Removidos do rastreamento e `.gitignore` corrigido (commits de 07/09/2026) | 07/09/2026 |

---

## 3. Erros em aberto (sem solução definitiva)

| Problema | O que já se sabe | Data |
|---|---|---|
| Rotação de tela não funciona | `"orientation": "default"` no `app.json` não teve efeito no Expo Go; talvez exija build nativo (`expo run:android` / EAS) | 07/09/2026 |
| Teclado cobre campos | `KeyboardAvoidingView` melhorou, mas não sobe o suficiente | 13/09/2026 |
| Prazo de cancelamento de 45 dias | Baseado em norma de um município (IN 2/2026); fontes conflitantes. **Não alterar sem confirmação do contador** | 13/09/2026 |
| Município A no Emissor Nacional | Prefeitura disse "a partir de 01/11/2026", mas uma empresa de teste já tinha nota real antes. Reconfirmar antes de ligar produção | 24–25/09/2026 |
| Município B no Emissor Nacional | Pode emitir por sistema próprio; importação vazia seria esperada. Conferir com "Consultar agora" (convênio) | 14/11/2026 |
| Nome do tomador na NF e data da emissão | `xNome` usa `apelido || razao_social`; `data_emissao_nf` grava a data do plantão (o prazo de 45 dias conta dela). Decisão de negócio pendente | 26/10/2026 |

---

## 4. Como registrar um erro novo

Copie uma linha da tabela do tema certo e preencha:

`| <mensagem ou código exato> | <causa confirmada> | <o que foi feito> | <arquivo> | <dd/mm/aaaa> |`

Se não houver tema que sirva, crie uma subseção nova na seção 2.
