#!/bin/bash
# Abre o DAYON - Treino no Simulador do iOS (sem iPhone, sem assinatura) e tira uma foto da tela.
#
# Uso (na raiz do projeto):  ./scripts/testar-no-simulador.sh
#
# Por que não é o mesmo build do iPhone: o leitor de QR code da carteirinha usa o MLKit do Google,
# que não traz versão para o simulador em Macs com chip Apple (só x86_64), e os simuladores do
# iOS 26 só rodam arm64. Este script tira esse único plugin durante o teste, compila para arm64,
# e devolve o Podfile como estava no fim. No iPhone de verdade o leitor funciona normalmente.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
# Node 24 (ou 22) do nvm na frente do PATH: o Node 26 do Homebrew gera PNGs com bytes diferentes.
for v in "$HOME"/.nvm/versions/node/v24.* "$HOME"/.nvm/versions/node/v22.*; do
  [ -x "$v/bin/node" ] && { export PATH="$v/bin:$PATH"; break; }
done
hash -r
export LANG=${LANG:-en_US.UTF-8}

cd "$ROOT/frontend"
[ -d node_modules ] || npm ci
npm run build:mobile > /tmp/dayon-sim-build.log 2>&1 || { tail -30 /tmp/dayon-sim-build.log; exit 1; }

cd ios/App
cp Podfile /tmp/dayon-Podfile.bak
restore() { cp /tmp/dayon-Podfile.bak Podfile; pod install > /dev/null 2>&1 || true; }
trap restore EXIT
sed -i '' "/CapacitorMlkitBarcodeScanning/d" Podfile
pod install > /tmp/dayon-sim-pod.log 2>&1
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath DerivedData/dayon-sim \
  CODE_SIGNING_ALLOWED=NO ARCHS=arm64 EXCLUDED_ARCHS= build > /tmp/dayon-sim-xcode.log 2>&1 \
  || { grep error: /tmp/dayon-sim-xcode.log | head; exit 1; }

UDID=$(xcrun simctl list devices available -j | python3 -I -c '
import json, sys
d = json.load(sys.stdin)["devices"]
phones = [x for k, v in d.items() if "iOS" in k for x in v if x["name"].startswith("iPhone")]
booted = [x for x in phones if x["state"] == "Booted"]
print((booted or phones)[-1]["udid"])')
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b > /dev/null
open -a Simulator
xcrun simctl install "$UDID" DerivedData/dayon-sim/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch "$UDID" com.dayon.treino
sleep 12
xcrun simctl io "$UDID" screenshot /tmp/dayon-simulador.png
echo "Pronto: o app está aberto no Simulador. Foto da tela em /tmp/dayon-simulador.png"
