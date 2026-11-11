#!/bin/bash
# Compila, assina e instala o DAYON - Treino no iPhone conectado por cabo.
#
# Uso (na raiz do projeto):
#   ./scripts/instalar-no-iphone.sh                  detecta o time e o iPhone sozinho
#   TEAM=ABCDE12345 ./scripts/instalar-no-iphone.sh  outro time da Apple Developer
#   SEM_WEB=1 ./scripts/instalar-no-iphone.sh        pula a parte web (já compilada antes)
#
# O app roda 100% no iPhone (sem servidor, sem login): os dados ficam no aparelho.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
BUNDLE_ID=com.dayon.treino
TEAM=${TEAM:-C38QUDH367}
LOG=/tmp/dayon-instalar.log

say()  { printf "\n\033[1;33m▶ %s\033[0m\n" "$*"; }
fail() { printf "\n\033[1;31m✖ %s\033[0m\n" "$*"; exit 1; }

command -v xcodebuild >/dev/null || fail "O Xcode não está instalado. Instale pela App Store e abra uma vez."

# 1) Node (a parte web do app) e CocoaPods (as bibliotecas do iOS)
# Node 24 (ou 22) do nvm na frente do PATH: o Node 26 do Homebrew gera PNGs com bytes diferentes.
for v in "$HOME"/.nvm/versions/node/v24.* "$HOME"/.nvm/versions/node/v22.*; do
  [ -x "$v/bin/node" ] && { export PATH="$v/bin:$PATH"; break; }
done
hash -r
command -v node >/dev/null || fail "Node.js não encontrado. Instale com: brew install node@22"
command -v pod >/dev/null || { say "Instalando CocoaPods (Homebrew)…"; brew install cocoapods; }
export LANG=${LANG:-en_US.UTF-8}

if [ -z "${SEM_WEB:-}" ]; then
  say "Preparando a parte web do app (pode levar alguns minutos na primeira vez)…"
  cd "$ROOT/frontend"
  [ -d node_modules ] || npm ci
  npm run build:mobile > "$LOG" 2>&1 || { tail -30 "$LOG"; fail "A parte web não compilou (log completo em $LOG)."; }
  cd "$ROOT"
fi
[ -f "$ROOT/frontend/ios/App/App.xcworkspace/contents.xcworkspacedata" ] || fail "Projeto iOS incompleto. Rode o script sem SEM_WEB=1."
say "Time da Apple Developer: $TEAM"

# 2) iPhone conectado
JSON=$(mktemp)
xcrun devicectl list devices --json-output "$JSON" >/dev/null 2>&1 || true
read -r UDID DEVID DEVNAME <<<"$(python3 -I - "$JSON" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for dev in d.get("result", {}).get("devices", []):
    hw = dev.get("hardwareProperties", {})
    if hw.get("platform") == "iOS" and hw.get("reality") == "physical" and hw.get("deviceType") in (None, "iPhone"):
        name = dev.get("deviceProperties", {}).get("name", "iPhone").replace(" ", "_")
        print(hw.get("udid", ""), dev.get("identifier", ""), name)
        break
PY
)"
rm -f "$JSON"
if [ -z "${UDID:-}" ]; then
  fail "Nenhum iPhone encontrado. Conecte o cabo, desbloqueie o iPhone e toque em “Confiar neste computador”."
fi
say "iPhone: ${DEVNAME//_/ } ($UDID)"

# 3) Compilar e assinar (o Xcode cria o perfil de desenvolvimento e o App Group sozinho)
say "Compilando e assinando…"
cd "$ROOT/frontend/ios/App"
set +e
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug \
  -destination "id=$UDID" -derivedDataPath DerivedData/dayon-device \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" build > "$LOG" 2>&1
RC=$?
set -e
if [ $RC -ne 0 ]; then
  if grep -q "isn't registered in your developer account" "$LOG"; then
    fail "O iPhone ainda não está liberado na conta Apple Developer (status “Processing”).
  A Apple leva de 24 a 72 horas para liberar um aparelho novo. Veja em
  developer.apple.com › Certificates, IDs & Profiles › Devices: quando aparecer
  “Enabled”, rode este script de novo."
  elif grep -qi "developer mode" "$LOG"; then
    fail "Ative o Modo de Desenvolvedor no iPhone: Ajustes › Privacidade e Segurança › Modo de Desenvolvedor, reinicie e confirme."
  elif grep -qi "locked" "$LOG"; then
    fail "O iPhone está bloqueado. Desbloqueie a tela e rode de novo."
  elif grep -qi "No Account for Team\|No signing certificate\|doesn't have an account" "$LOG"; then
    fail "O Xcode não tem a conta do time $TEAM. Abra o Xcode › Ajustes › Contas, entre com o Apple ID do time e rode de novo."
  else
    grep -E "error:" "$LOG" | sort -u | head -10
    fail "A compilação falhou (log completo em $LOG)."
  fi
fi
APP="$ROOT/frontend/ios/App/DerivedData/dayon-device/Build/Products/Debug-iphoneos/App.app"
[ -d "$APP" ] || fail "O app compilado não foi encontrado em $APP."

# 4) Instalar e abrir
say "Instalando no iPhone…"
if ! xcrun devicectl device install app --device "$DEVID" "$APP" > "$LOG" 2>&1; then
  if grep -qi "locked" "$LOG"; then
    fail "O iPhone está bloqueado. Desbloqueie a tela e rode: SEM_WEB=1 ./scripts/instalar-no-iphone.sh"
  elif grep -qi "developer mode" "$LOG"; then
    fail "Ative o Modo de Desenvolvedor: Ajustes › Privacidade e Segurança › Modo de Desenvolvedor."
  else
    tail -15 "$LOG"
    fail "Não foi possível instalar (log em $LOG)."
  fi
fi
say "Abrindo o DAYON - Treino…"
if ! xcrun devicectl device process launch --device "$DEVID" "$BUNDLE_ID" > "$LOG" 2>&1; then
  if grep -qi "locked" "$LOG"; then
    echo "O app foi instalado, mas o iPhone está bloqueado. Desbloqueie e toque no ícone DAYON."
  else
    echo "O app foi instalado. Se ele não abrir: no iPhone, Ajustes › Geral › VPN e Gerenciamento de Dispositivo"
    echo "› toque no desenvolvedor (Apple Development) › Confiar. Depois toque no ícone DAYON."
  fi
fi
say "Pronto! ✅  O DAYON - Treino está no iPhone."
