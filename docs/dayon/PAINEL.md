# Painel Dayon: etapas 1 a 3 (conta Dayon, nuvem, regras e painel do personal)

Este documento explica o que foi feito no código, o que você (Léo) ainda precisa ligar no
Console do Firebase e como tudo se encaixa. Este texto descreve o código da branch `painel-web`;
publicar as regras e o site (deploy) é um passo à parte, feito por você quando quiser.

Projeto Firebase: **`dayon---treino`** (plano gratuito **Spark**, sem Cloud Functions).

---

## 1. O que foi implementado (e onde)

### Para o aluno, no app e no site

- **"Entrar na Dayon" é opcional.** No celular, a primeira tela continua com
  **"Usar neste dispositivo"** do mesmo jeito (caminho principal). Ao lado dela apareceu
  **"Entrar na Dayon"**; quem já usa o modo local liga a conta quando quiser em
  **Ajustes > Conta > Conta Dayon**. O "Conectar ao meu servidor" (openGym próprio) continua igual.
- **Login por e-mail e senha** (criar conta, entrar, esqueci a senha, sair). Erros em português claro
  (e-mail já usado, senha fraca, senha errada, sem internet...).
- **Sair da conta não apaga nada do aparelho.** No site existe também "Sair e limpar este navegador",
  para computador compartilhado (só apaga o que está no navegador, nunca a nuvem).
- **Sincronização do plano e do histórico** com o Firestore, usando o mesmo merge que o app já usa
  entre dois aparelhos (`lib/sync-merge.js`, campo a campo pelos carimbos de edição).
- **Offline**: a falha de rede não perde nada (os dados ficam no `localStorage` e, no celular, no
  arquivo nativo, como sempre). O app tenta de novo sozinho (30 s, 1, 2 e 5 min, e quando a
  internet volta). O status aparece só em Ajustes > Conta, sem atrapalhar o treino.
- **O treino em andamento nunca vai para a nuvem** e nunca é mexido por ela.
- **O site** (build do Hosting) mostra o login Dayon na frente e, depois de entrar, o app igual ao
  do celular (mesma organização do openGym, visual Dayon), **sem as imagens/vídeos dos exercícios**.

### Etapa 3: painel do personal

**O personal** (`perfil.papel === 'personal'`) tem o **Painel do personal** (rota `/trainer`),
aberto em Ajustes > Conta ("Painel do personal") e na folha da Conta Dayon:

- **Convidar um aluno**: gera o código (`convitesAluno`), mostra grande com **Copiar** (área de
  transferência + aviso "Código copiado"). Os códigos ainda não usados ficam listados, cada um com
  copiar e **cancelar** (com confirmação; grava `ativo: false`).
- **Alunos**: nome, status (ativo, encerrado) e último treino ("Último treino 9 de nov." ou
  "Nenhum treino ainda"). Para economizar leituras do Spark, cada aluno ativo custa 2 leituras
  (o perfil e **um** treino, o mais novo: `orderBy('d', 'desc')` + `limit(1)`, índice automático).
  Vínculos encerrados não são lidos; o nome vem da memória do aparelho (`dayon_nomes`).
- **Abrir um aluno** (`/trainer/{alunoId}`):
  - **Histórico só leitura**: 30 treinos por vez ("Mostrar mais"), tocando abre o treino com os
    exercícios e as séries, sem editar nem apagar (as regras também não deixam).
  - **Editar plano**: abre as telas de Plano e Rotina do próprio app (mesma organização e funções:
    agenda semanal, rodízio, rotinas, exercícios) com o plano do aluno. Uma barra no topo diz
    **"Editando o plano de {nome}"** com **Salvar** e **Sair** (sair com mudança pede confirmação).
  - **Encerrar vínculo**, com confirmação.

**Como o plano do aluno é editado sem mexer nos dados do personal**: as telas de plano leem e
gravam o `S` do app. Enquanto o personal edita, o app mostra uma **cópia de trabalho** (o mesmo
"sandbox" que o tour guiado já usava: `useStore.enterTourSandbox`): nada dela é salvo no
`localStorage`, no arquivo do celular, no servidor próprio nem na nuvem Dayon do personal, e os
widgets/relógio não a recebem. A cópia é a do próprio personal (idioma, tema, ajustes) com
todos os campos do plano trocados pelos do aluno e **sem treinos**. Ao salvar, só a parte do
plano sai dela (`splitState(...).plan`) e vai para `users/{alunoId}/plan/atual`, numa transação
que confere se o plano ainda é o que foi aberto; se o aluno salvou no meio, o app lê de novo,
mescla campo a campo (`mergeStates`) e grava. Ao sair (salvando ou não), a cópia original do
personal volta exatamente como estava. O personal nunca lê `estado` nem escreve `estado` ou
`workouts` do aluno. A sincronização Dayon do próprio personal fica parada enquanto a cópia está
na tela e volta sozinha depois.

**Correção do `por`**: `gravarNuvem` gravava `por` com o uid do caminho; agora grava o uid de quem
está logado (`auth.currentUser`), que é o que as regras exigem. Para o aluno é o mesmo de antes;
para o personal salvando o plano do aluno, é o personal.

**O aluno**: na Conta Dayon, em "Seu personal", aparece o **nome do personal** vinculado (as regras
deixam o aluno ler o perfil do personal com vínculo ativo) com **Encerrar vínculo** (confirmação).
Quando o personal muda o plano, o próximo sync aplica a mudança pelo merge de sempre e mostra um
aviso curto (toast): **"Plano atualizado pelo personal"**. Só avisa quando o plano da nuvem foi
gravado por outra pessoa (`por` diferente do aluno), não é o que o aparelho já conhecia e o merge
mudou o plano local; syncs sem mudança no plano não avisam.

**Faixa "Modo visitante"**: com login na Dayon (e a nuvem não pausada por servidor próprio) a faixa
de baixo "Modo visitante: seus dados ficam só neste navegador. Entrar" e a linha igual em
Ajustes > Conta não aparecem mais (`dayonCovers` em `SyncBanner.jsx`). Sem login Dayon e sem
servidor, continua como antes.

### Arquivos principais

| Arquivo | Para quê |
|---|---|
| `firestore.rules` | As regras de segurança (quem lê e escreve o quê). |
| `firebase.json`, `.firebaserc`, `firestore.indexes.json` | Config do Hosting e do Firestore (projeto `dayon---treino`). |
| `firestore-tests/rules.test.mjs` | Testes das regras no emulador. |
| `frontend/.env.example` | Os nomes das variáveis da config Web (só placeholders). |
| `frontend/src/lib/dayon-config.js` | Lê a config; sem ela, o login fica indisponível e o app segue local. |
| `frontend/src/lib/dayon-model.js` | Divide o estado em documentos e remonta (puro, com testes). |
| `frontend/src/lib/dayon-sync.js` | Uma sincronização: ler, mesclar, gravar (puro, com testes). |
| `frontend/src/lib/dayon-cloud.js` | O único lugar que fala com o Firebase (Auth e Firestore). |
| `frontend/src/lib/dayon-errors.js` | Mensagens de erro em linguagem simples. |
| `frontend/src/store/useDayon.js` | A conta Dayon no aparelho e quando sincronizar. |
| `frontend/src/components/DayonAccount.jsx` | As telas: entrar, conta, códigos, portão do site, seu personal. |
| `frontend/src/lib/dayon-trainer.js` | Etapa 3: monta a cópia de trabalho com o plano do aluno e salva só o plano (puro, com testes). |
| `frontend/src/store/useTrainer.js` | Etapa 3: o modo "editando o plano de um aluno" (abrir, salvar, sair). |
| `frontend/src/views/TrainerPanel.jsx` | Etapa 3: o painel do personal (convites, alunos, histórico, plano, encerrar). |
| `frontend/src/components/StudentPlanBar.jsx` | Etapa 3: a barra "Editando o plano de ..." com Salvar e Sair. |
| `frontend/scripts/check-hosting-bundle.mjs` | Confere que o build do site não leva mídia de exercício. |

---

## 2. Como os dados ficam no Firestore

```
users/{uid}                    perfil: nome, papel ('aluno' | 'personal'), email, criadoEm, atualizadoEm
users/{uid}/plan/atual         o plano (rotinas, semana, dayPlan, rotação, programas, exercícios
                               próprios, cargas atuais e ajustes por exercício)
users/{uid}/estado/atual       o resto que sincroniza (ajustes, pesagens, medidas, notas...)
users/{uid}/workouts/{id}      um documento por treino, com o id que o treino já tem no app
vinculos/{personalId_alunoId}  { personalId, alunoId, status: 'pendente' | 'ativo' | 'encerrado' }
convitesPersonal/{codigo}      códigos para virar personal (você cria no Console)
convitesAluno/{codigo}         códigos que um personal cria para ligar um aluno
```

- Cada documento de dados guarda o conteúdo como texto JSON no campo `json`, mais `v`, `ts`,
  `atualizadoEm` (hora do servidor) e `por` (quem escreveu).
- **Limite de 1 MB por documento**: por isso cada treino é um documento. O plano e o "resto" têm
  um teto de segurança (950 mil caracteres); se passar, aquela parte não sobe, o app avisa e
  os dados continuam no aparelho (nada é cortado).
- **Não vão para a nuvem**: o treino em andamento e a conversa com o Treinador IA.
- Para economizar leituras do plano Spark (50 mil por dia), cada sincronização lê o plano, o
  resto e **só os treinos gravados desde a última leitura**.

### Regra de destino (servidor próprio x nuvem Dayon)

A nuvem Dayon só sincroniza quando o aparelho **não** está ligado a um servidor openGym próprio.
Se estiver emparelhado com um servidor, a nuvem Dayon fica **em pausa** (aparece
"Pausado: este aparelho sincroniza com o seu próprio servidor"). Assim nunca há dois destinos
mesclando um ao outro. O `pushState`/`pullState` do servidor próprio não foi alterado.

### Trocar de conta no mesmo aparelho

Se o aparelho tem dados de outra conta Dayon e alguém entra com uma conta diferente, o app
pergunta: **Juntar** com esta conta ou **Sair**. Ele nunca mistura sem perguntar.

---

## 3. Quem pode o quê (regras)

| | Aluno (dono) | Personal com vínculo `ativo` | Qualquer outra pessoa |
|---|---|---|---|
| Perfil `users/{uid}` | lê; muda o nome | lê (nome, e-mail) | nada |
| Plano `plan/atual` | lê e escreve | **lê e escreve** | nada |
| Histórico `workouts/*` | lê e escreve | **só lê** | nada |
| Resto `estado/atual` | lê e escreve | nada | nada |

- Sem login, nada.
- Toda conta nova nasce **aluno**. Ninguém se promove sozinho; ninguém lista os usuários.
- O aluno também pode editar o plano que o personal montou (a decisão foi essa). Se os dois
  editarem ao mesmo tempo, o app percebe (transação) e mescla em vez de sobrescrever.
- Vários personais podem existir; cada um só acessa os alunos com quem tem vínculo **ativo**.
  Vínculo `pendente` ou `encerrado` não dá acesso a nada.
- Listar vínculos só com filtro `personalId == meu uid` ou `alunoId == meu uid`.
- O personal **não escreve** o histórico nem o perfil do aluno e não lê o `estado` (pesagens etc.).
- Por que o personal pode ler o perfil do aluno: só para mostrar o nome dele no painel.
  O aluno também lê o perfil do personal com quem tem vínculo ativo (para ver o nome).

---

## 4. Como alguém vira personal (convites de uso único)

Sem Cloud Functions, a promoção é feita assim:

1. **Você** cria um documento em `convitesPersonal/{codigo}` no Console (passo a passo abaixo).
2. A pessoa entra no app/site com a conta dela (nasce aluno) e, em **Ajustes > Conta >
   Conta Dayon > "Você é personal?"**, digita o código.
3. O app envia **um lote (batch)** com duas escritas juntas: (a) marca o convite como usado por
   ela e (b) muda o `papel` dela de `aluno` para `personal`.
4. As regras só aceitam (b) se, no mesmo lote, o convite estava livre antes e fica em nome dela
   depois (`get` e `getAfter`). E só aceitam (a) se (b) estiver no mesmo lote. Um convite usado,
   desativado ou inexistente falha; o mesmo código não serve duas vezes.
5. Ninguém consegue criar, apagar ou listar convites de personal pelo app: só você, no Console.

### Vínculo personal ↔ aluno

1. O personal (já promovido) abre o **Painel do personal** (Ajustes > Conta, ou a folha da
   Conta Dayon) e toca em **"Criar um código para aluno"**. O código (ex.: `K7PM-2QXH-9RTA`)
   aparece grande, com o botão **Copiar**, e ele manda para o aluno.
2. O aluno, em **Ajustes > Conta > Conta Dayon > "Seu personal"**, digita o código e toca em
   **Vincular**.
3. O app envia um lote: marca o convite como usado e cria `vinculos/{personalId}_{alunoId}`
   com `status: 'ativo'`. As regras conferem que o convite era desse personal, estava livre e
   que quem resgata é o próprio aluno.
4. Encerrar: o aluno (na Conta Dayon, ao lado do nome do personal) ou o personal (na página do
   aluno no painel) toca em **Encerrar vínculo** e confirma; o status vira `encerrado`. Religar
   exige um código novo do mesmo personal.

O status `pendente` existe no modelo, mas este fluxo não precisa dele: o convite em aberto
(`convitesAluno` com `ativo: true`) faz esse papel, e o vínculo já nasce `ativo` quando o aluno aceita.

---

## 5. O que falta você ativar no Console do Firebase (nesta ordem)

> Nada disso foi feito por mim. Faça quando quiser; sem estes passos o app funciona normalmente
> no modo local e o "Entrar na Dayon" só mostra que ainda não está disponível.

1. **Authentication > Método de login > E-mail/senha**: ativar (só "E-mail/senha"; o "link por
   e-mail" pode ficar desligado).
2. **Firestore Database > Criar banco de dados**: escolha **modo de produção** (as regras de
   verdade serão publicadas depois). Local sugerido: **`southamerica-east1` (São Paulo)**, mais perto
   dos alunos. Atenção: o local é escolhido uma vez só e não muda depois; é decisão sua no console.
3. **Configurações do projeto > Seus apps > Adicionar app > Web (`</>`)**: nome "Dayon Treino Web"
   (não precisa marcar o Hosting aqui). Copie o objeto `firebaseConfig` que aparece e preencha
   um arquivo **`frontend/.env.local`** (nunca no git; o `.gitignore` já bloqueia):
   ```
   VITE_FIREBASE_API_KEY=...            (apiKey)
   VITE_FIREBASE_AUTH_DOMAIN=...        (authDomain)
   VITE_FIREBASE_PROJECT_ID=dayon---treino
   VITE_FIREBASE_STORAGE_BUCKET=...     (storageBucket)
   VITE_FIREBASE_MESSAGING_SENDER_ID=...(messagingSenderId)
   VITE_FIREBASE_APP_ID=...             (appId, o que tem ":web:")
   ```
   Não use os valores do `GoogleService-Info.plist` (esse é o app iOS do push, outro app).
   Depois de preencher, gere de novo o build (web e celular) para a config entrar.
4. **Publicar as regras** (`firestore.rules`): a etapa 3 **não mudou** as regras; tudo o que o
   painel faz já é coberto por elas (veja a seção 3).
5. **Criar um código de personal** (com as regras publicadas):
   1. Firestore Database > Dados > **Iniciar coleção** > ID da coleção: `convitesPersonal`.
   2. ID do documento: o código, por exemplo `PERSONAL-7K2M-9QXA`. Use **letras maiúsculas,
      números e hífen**, pelo menos 12 caracteres, difícil de adivinhar. Um código por pessoa.
      O ID diferencia maiúsculas de minúsculas: o app procura o código **exatamente como foi
      digitado** (só tira espaços e quebras de linha) e, se não achar, em MAIÚSCULAS. Um código
      com minúsculas funciona se for colado igual; em maiúsculas é mais fácil de digitar no
      celular. (Até 11/11/2026 o app convertia tudo para maiúsculas e um código com minúsculas
      nunca era achado: "Usar" não fazia nada. Corrigido no app; as regras não mudaram.)
   3. Campos:
      - `ativo` (boolean) = `true`
      - `usadoPor` (null) = `null`
      - `usadoEm` (null) = `null`
      - `criadoEm` (timestamp) = agora (opcional)
   4. Salve e mande o código para a pessoa. Depois de usado, o documento mostra `usadoPor` com o
      uid de quem usou. Para cancelar um código ainda não usado, mude `ativo` para `false` ou apague.
6. **Firebase Hosting**: os arquivos já estão prontos (`firebase.json` aponta para `frontend/dist`
   do build do site). O deploy fica para depois.

Se você restringir a chave de API (Google Cloud > Credenciais) por "referenciadores HTTP",
inclua o domínio do site **e** `capacitor://localhost` e `https://localhost` (o app do iPhone e
do Android), senão o login do app para de funcionar.

---

## 6. Comandos

```bash
# Testes do app (rodados: todos passam)
cd frontend && npm test

# Só os testes da nuvem Dayon e do painel do personal
cd frontend && npx vitest run src/lib/dayon-model.test.js src/lib/dayon-sync.test.js src/store/useDayon.test.js \
  src/lib/dayon-trainer.test.js src/store/useTrainer.test.jsx src/views/TrainerPanel.test.jsx

# Build web normal (o mesmo de sempre)
cd frontend && npm run build

# Build do site para o Firebase Hosting: sem VITE_MOBILE, sem copiar catalogue/media,
# VITE_DAYON_CLOUD=1 (desliga a mídia licenciada) e confere o dist no fim
cd frontend && npm run build:hosting

# Testes das regras no emulador do Firestore (precisa de Java 11+ instalado; ver "Limites")
cd firestore-tests && npm install && npm test
```

**Publicar (futuro, NÃO foi feito):**

```bash
cd frontend && npm run build:hosting
cd .. && npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project dayon---treino
npx firebase-tools deploy --only hosting --project dayon---treino
```

---

## 7. Limites e riscos

- **Plano Spark**: 50 mil leituras, 20 mil gravações e 20 mil exclusões por dia, 1 GiB guardado.
  O app lê só o que mudou, mas muitos alunos abrindo o app o dia todo podem chegar perto.
  Se passar, a nuvem recusa até o dia seguinte e o app segue com os dados no aparelho.
- **1 MB por documento**: o plano e o "resto" têm teto; um perfil gigante (centenas de exercícios
  próprios com descrições longas) poderia não caber. O app avisa e mantém tudo no aparelho.
- **Mídia não vai ao site**: as imagens e vídeos dos exercícios (Gym visual) são licenciados só
  para o app (NOTICE.md). No site os exercícios aparecem sem figura. O `check-hosting-bundle.mjs`
  falha o build se alguma mídia aparecer no `dist`.
- **Fotos e vídeos próprios** (de exercícios personalizados, de treinos, fotos de progresso) não
  sobem para a nuvem nesta etapa; só a referência. Ficam no aparelho onde foram feitos.
- **AGPL**: o código desta versão está público em
  [github.com/leosantoscba7/dayon-treino](https://github.com/leosantoscba7/dayon-treino)
  (conta `leosantoscba7`). O link "Código-fonte · Licença AGPL-3.0" aparece em letra miúda no
  rodapé do Início (só no site) e em Ajustes → Sobre, apontando para esse repositório. O crédito
  ao openGym de Duarte Santos continua no mesmo bloco, com o link do projeto original. A mídia
  dos exercícios (Gym visual) **não** entra no repositório nem no site; o README explica como
  obtê-la com licença própria. O histórico git local não foi publicado: o repositório público é
  um snapshot limpo (um único commit), para não levar as mídias nem qualquer arquivo local
  ignorado (.env.local, plists do Firebase, certificados, senhas de teste).
- **Convites criados à mão**: dependem de você no Console. Um código vazado pode ser usado por
  quem o tiver primeiro (uso único). Crie códigos longos e só entregue para a pessoa certa.
- **E-mail sem verificação obrigatória** nesta etapa: alguém pode criar conta com um e-mail que
  não é dele. Implicação: o e-mail do perfil não prova identidade. Como o vínculo exige um código
  que o personal entrega pessoalmente ao aluno, isso não abre acesso aos dados de ninguém; mas
  antes de usar o e-mail para algo sério (recuperar acesso por suporte, cobrança), ligue a
  verificação de e-mail.
- **Apagar treinos**: um treino só é apagado na nuvem quando o app registrou a remoção (como no
  sync do openGym). Se a cópia local sumir, a nuvem não esvazia o histórico.
- **Corrida rara**: duas gravações quase simultâneas do mesmo aluno em dois aparelhos são
  tratadas pela transação do plano/resto; os treinos são documentos separados e se juntam.
- **Emulador não rodou aqui**: este Mac não tem Java (o `/usr/bin/java` é só o atalho do macOS
  que abre o instalador). Os testes das regras estão escritos (`firestore-tests/rules.test.mjs`,
  25 casos) mas **não foram executados**. Rode `cd firestore-tests && npm test` num computador com
  Java 11+ antes de publicar as regras.
- **Edição do plano do aluno**: enquanto a barra "Editando o plano de ..." está no topo, o resto
  do app (Início, Treino) também mostra a cópia de trabalho. Um treino feito nesse meio tempo não é
  salvo em lugar nenhum (só o plano sobe ao salvar). Se o tour guiado começar ou outra aba sair da
  conta, a edição é descartada.
- **Nomes de vínculos encerrados**: as regras não deixam mais ler o perfil; o painel mostra o nome
  que o aparelho guardou antes, ou "Aluno".
- **Celular**: nada do projeto nativo (iOS/Android) foi alterado. O SDK web do Firebase roda
  dentro do WebView; o login do app só funciona depois do passo 3 do Console e de um build novo.

### Busca de exercícios no editor do plano (painel do personal)

- Depois de "Adicionar à rotina", a folha de busca **continua aberta** de propósito, para
  incluir vários exercícios seguidos. Havia só o gesto de fechar (Esc ou arrastar para baixo).
  Agora o botão **Concluir** no topo da folha fecha a busca.
- O chip **Escolhidos (N)** ao lado da busca não é uma seleção residual: conta os exercícios
  que já estão nas rotinas ou no histórico da cópia em edição (o plano do aluno, quando o
  personal está editando). Pode aparecer "Escolhidos (1)" antes de você marcar qualquer
  item nesta sessão, se o plano ou o histórico já tiver um exercício.

### Sincronização sozinha (sem "Sincronizar agora")

O aluno não precisa tocar em "Sincronizar agora" depois de editar o plano. Em
`store/useDayon.js`, qualquer mudança na cópia local agenda `syncNow()` em 1,5 s
(`changed()`, `DEBOUNCE_MS`). Também há uma leitura a cada 5 minutos, ao voltar para o
app e ao recuperar a internet. "Sincronizar agora" só adianta esse envio. Exceção: enquanto
o personal edita o plano do aluno (cópia isolada, `tourSandbox`), essa sincronização automática
não roda — o plano do aluno sobe só ao salvar no painel.

---

## 8. Commits na branch `painel-web`

1. Adicionar regras do Firestore, config do Firebase Hosting e testes das regras
2. Adicionar o modelo dividido e o motor de sincronização com a nuvem Dayon
3. Adicionar login opcional "Entrar na Dayon" e a sincronização com o Firestore
4. Testes da conta Dayon e documentação do painel (este arquivo)
5. Corrigir a leitura do perfil no teste de promoção a personal

Etapa 3:

6. Esconder a faixa "Modo visitante" quando há login na Dayon
7. Nuvem do personal: plano do aluno numa cópia isolada e `por` correto
8. Adicionar o painel do personal e o vínculo visível para o aluno
9. Avisar o aluno quando o personal atualizar o plano
10. Documentar a etapa 3 do painel (este arquivo)

Etapa 4 (código-fonte público e link AGPL):

11. Publicar o snapshot limpo em github.com/leosantoscba7/dayon-treino, com o link
    "Código-fonte · Licença AGPL-3.0" em letra miúda no Início (site) e em Ajustes → Sobre,
    o botão Concluir na busca de exercícios, e estas notas.

A branch `painel-web` continua só neste computador; `master` não foi alterada. O repositório
público no GitHub é um snapshot à parte (um commit, sem o histórico local e sem a mídia dos
exercícios).
