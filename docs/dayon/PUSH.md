# Avisos para os usuários (push remoto) no DAYON - Treino

*10 de novembro de 2026 (projeto Firebase ligado)*

O app agora sabe **receber avisos enviados pela Dayon**, mesmo fechado: por exemplo "Treino novo
no plano de dezembro" ou "Bom dia, hoje é dia de perna". Quem envia é o **Firebase**, um serviço
gratuito do Google, por um site. Não precisa de servidor nem de programador para mandar cada aviso.

Os lembretes de treino e o aviso de fim do descanso continuam iguais: eles são do próprio celular
e não dependem do Firebase.

O projeto no Firebase já está criado e ligado ao app: **DAYON - Treino** (id `dayon---treino`).
Os arquivos do Firebase estão no Mac de compilação (fora do git). A autenticação com a Apple
(APNs) está feita por **certificado** (arquivo `.p12`, válido até **10/12/2027**; renovar antes
dessa data).

---

## Como mandar um aviso

1. Abra o painel de mensagens do projeto:
   <https://console.firebase.google.com/project/dayon---treino/messaging>
   (entre com a conta Google da Dayon, se pedir).
2. Clique em **Nova campanha** e escolha **Notificações**.
3. Escreva o **título** (curto, ex.: "Treino novo!") e o **texto** da mensagem.
   Se quiser, clique em "Enviar mensagem de teste" para ver no seu celular antes.
4. Em **Segmentação / Destino**, escolha **Tópico** e digite o nome do tópico:
   - **todos**: todo mundo que tem o app e aceitou notificações (o normal);
   - **ios**: só quem usa iPhone;
   - **android**: só quem usa Android.
5. Escolha **Agora** (ou um dia e hora), clique em **Revisar** e depois em **Publicar**.

Pronto: em poucos segundos o aviso chega a quem tem o app. Tocar no aviso abre o app.

**Bom saber**
- Só recebe quem tocou em **Permitir** quando o app perguntou sobre notificações (logo depois de
  "Usar neste dispositivo", na tela "Nunca perca o fim de um descanso"). Quem negou pode ligar
  depois em Ajustes do celular › Notificações › DAYON.
- Avisos de push não funcionam no Simulador do Mac, só em celular de verdade.
- Use com carinho: muitos avisos fazem as pessoas desligarem as notificações do app.

---

## O que já está configurado

Isto foi feito em 10/11/2026. Nada no código do app precisa ser reprogramado para o envio
começar a funcionar em um iPhone de verdade (depois que o aparelho for liberado pela Apple e o
app for instalado nele).

### 1. Projeto no Firebase

Projeto **DAYON - Treino**, id **`dayon---treino`**.

Dentro dele estão:

- **um app iOS** com o código (Bundle ID) **`com.dayon.treino`**;
- **dois apps Android**: **`com.dayon.treino`** (o app de verdade) e **`com.dayon.treino.test`**
  (a versão de teste do Android usa esse nome; sem ele, a versão de teste não compila).

Painel para disparar avisos:
<https://console.firebase.google.com/project/dayon---treino/messaging>

### 2. Arquivos do Firebase no projeto

Os dois arquivos já estão no Mac, nestes caminhos:

| Arquivo | Onde está (caminho completo) |
|---|---|
| `GoogleService-Info.plist` (iPhone) | `/Users/leosantoscba/CLAUDE PROJETOS/dayon-treino/frontend/ios/App/App/GoogleService-Info.plist` |
| `google-services.json` (Android) | `/Users/leosantoscba/CLAUDE PROJETOS/dayon-treino/frontend/android/app/google-services.json` |

- O projeto do iPhone copia o arquivo para dentro do app sozinho quando ele existe, e o Android
  também o usa sozinho.
- Os dois arquivos **não vão para o git** (estão no `.gitignore`), porque o código do app vai ser
  público. Guarde uma cópia deles num lugar seguro.
- Nunca use um arquivo "inventado" ou de outro app: o projeto do iPhone confere o arquivo e, se ele
  não for de `com.dayon.treino`, não o usa (o push fica desligado em vez de o app dar erro).

### 3. Autenticação APNs da Apple (certificado)

A conta da Apple já tinha atingido o limite de chaves (`.p8`), então a autenticação com o
Firebase foi feita por **certificado de notificações** (arquivo `.p12`), só para o Dayon.

- O certificado está válido até **10/12/2027**. **Renovar antes dessa data**, senão os avisos
  deixam de chegar no iPhone.
- Push Notifications já está ligado no cadastro do app **`com.dayon.treino`** na Apple.
- Team ID: **`C38QUDH367`** (GOLD LINE AGENCIA DIGITAL LTDA). Bundle ID: **`com.dayon.treino`**.

Para renovar, mais para a frente: criar um certificado novo de Apple Push Notification
(em Certificates, Identifiers & Profiles), exportar o `.p12` e trocar o certificado antigo em
Firebase › Configurações do projeto › Cloud Messaging › app iOS (certificado APNs).

### 4. No aparelho

O próximo app instalado (pelo Xcode ou pela loja) já entra nos tópicos "todos" e "ios"/"android"
ao ser aberto, e o envio da seção acima passa a funcionar. O Simulador do Mac não recebe push.

---

## Para quem mexe no código

- Plugin: **`@capacitor-firebase/messaging` 8.6** (Capawesome), para Capacitor 8. Escolhido porque
  dá o token do Firebase e a **inscrição em tópicos** (`subscribeToTopic`) no iPhone e no Android
  com o mesmo código; o oficial `@capacitor/push-notifications` não inscreve em tópicos e, no
  iPhone, só devolve o token da Apple. A partir da 8.x ele **não chama `FirebaseApp.configure()`
  quando falta o `GoogleService-Info.plist`** e responde "not configured" em vez de travar o app.
  O JS do pacote não é importado (ele traria o SDK web do Firebase): `src/lib/remote-push.js`
  fala com o plugin nativo por `registerPlugin('FirebaseMessaging')`.
- `src/lib/remote-push.js` (+ `remote-push.test.js`): ao abrir o app, depois dos passos da primeira
  abertura (`App.jsx`), se a permissão de notificação já foi dada, pega o token, guarda em
  `localStorage` (`dayon_push_token`) e inscreve nos tópicos `todos` e `ios`/`android`. Nunca abre
  diálogo próprio: a permissão é a do passo "notifications" que o openGym já tinha
  (`lib/onboarding-perms.js`, `views/PermissionSteps.jsx`, que ganhou a linha "Avisos e novidades
  da Dayon, de vez em quando"). No iPhone essa permissão vale também para push remoto; no Android
  13+ é a mesma `POST_NOTIFICATIONS`. Sem Firebase, sem permissão ou com erro: só registra no log.
- Push com o app aberto: o iPhone mostra o banner sozinho (`capacitor.config.json`,
  `FirebaseMessaging.presentationOptions`); no Android o app mostra como notificação local.
- iPhone: `App.entitlements` com `aps-environment` = `development` (o Xcode troca para
  `production` ao exportar para a App Store), `remote-notification` em `UIBackgroundModes`
  (`Info.plist`), repasses do token em `AppDelegate.swift` e a fase de build
  "DAYON Firebase config (optional)" no `project.pbxproj`, que copia o plist só se ele existir e
  for do bundle certo. Com o arquivo no lugar, o build registra
  "GoogleService-Info.plist copied, remote pushes on".
- Android: `com.google.gms:google-services` no `android/build.gradle`, aplicado em
  `android/app/build.gradle` só se `google-services.json` existir; ícone pequeno da notificação
  no `AndroidManifest.xml`; o build F-Droid deixa o plugin de fora (como o ML Kit).
