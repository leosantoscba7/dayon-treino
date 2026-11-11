# Dayon Treino: notas rápidas

App de treino do Léo (marca Dayon), derivado do openGym (AGPL-3.0, código aberto mantido sob AGPL).
Esta pasta é a cópia de trabalho do app. A base original fica intacta em
`../APP TREINO - DAYON/openGym-base` e não deve ser alterada.

Estado detalhado, decisões e próximos passos: **[RELATORIO-DAYON.md](RELATORIO-DAYON.md)**.

## O essencial

| | |
|---|---|
| Nome oficial | DAYON - Treino (na tela inicial do celular: "DAYON") |
| Bundle ID iOS / applicationId Android | `com.dayon.treino` |
| Extensões iOS | `.widgets`, `.watchkitapp`, `.watchkitapp.widgets`, `.AnimationPacksDownloader`, `.uitests` |
| App Group | `group.com.dayon.treino` |
| Esquema de URL | `dayontreino://` |
| Time Apple | GOLD LINE AGENCIA DIGITAL LTDA, `C38QUDH367` (assinatura automática) |
| Idioma padrão | pt-BR (`APP_DEFAULT_LANG` em `frontend/src/lib/default-lang.js`) |
| Visual | tema claro (branco) com verde lima `#a8ef3d` → folha `#30a323`; logo DAY (serifa itálica) + ON (pílula verde). Referências em `design-ref/` |
| Ícone, splash, favicon | `cd frontend && swift resources/dayon/compor-marca.swift` (bases do Higgsfield em `design-ref/higgsfield-raw/`, texto sempre por código) |

## Comandos

```bash
./scripts/instalar-no-iphone.sh     # compila, assina e instala no iPhone ligado no cabo
./scripts/testar-no-simulador.sh    # abre no Simulador do iOS
cd frontend && npm test             # testes
```

## Conta Dayon e site (painel)

Login opcional por e-mail/senha e sincronização com o Firestore: **[docs/dayon/PAINEL.md](docs/dayon/PAINEL.md)**
(o que falta ligar no Console, como habilitar um personal, comandos). Nada foi publicado ainda.

## Cuidados

- O usuário final usa o modo local do app (`VITE_MOBILE=1`): sem login, sem servidor, sem Docker.
- Não reintroduzir links do openGym (opengym.ch, doações, App Store/Play do openGym).
- Mídia dos exercícios (Gym visual) tem licença própria, só para o openGym: ver NOTICE.md.
- `design-ref/`: referências visuais do Léo, bases do Higgsfield (sem texto) e o wordmark gerado.
- Nunca pedir à IA de imagem para escrever texto ou o nome "DAY ON" na imagem.
