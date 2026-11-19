#!/usr/bin/env bash
set -Eeuo pipefail

# Build a signed production APK without creating, replacing, or logging signing keys.
# Required environment variables are documented in ANDROID_GPS_RELEASE.md.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

required=(
  PIKI_SIGNING_STORE_FILE
  PIKI_SIGNING_STORE_PASSWORD
  PIKI_SIGNING_KEY_ALIAS
  PIKI_SIGNING_KEY_PASSWORD
  PIKI_EXPECTED_UPLOAD_CERT_SHA256
  PIKI_PLAY_MAX_VERSION_CODE
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: falta la variable protegida $name" >&2
    exit 1
  fi
done

if [[ ! -f "$PIKI_SIGNING_STORE_FILE" ]]; then
  echo "ERROR: no existe PIKI_SIGNING_STORE_FILE; no se crea una keystore nueva." >&2
  exit 1
fi

if [[ ! -f pnpm-lock.yaml ]]; then
  echo "ERROR: falta pnpm-lock.yaml; se detiene para evitar dependencias no reproducibles." >&2
  exit 1
fi

export VITE_API_URL="${VITE_API_URL:-https://api.pikidelivery.com}"

echo "1/7 Instalando dependencias fijadas..."
pnpm install --frozen-lockfile

echo "2/7 Validando TypeScript y tests..."
pnpm run check
pnpm test

echo "3/7 Generando el bundle web de producción..."
pnpm run build

echo "4/7 Sincronizando Capacitor Android..."
pnpm exec cap sync android
python3 scripts/android-identity.py check --synced

# This validates the existing upload certificate, alias, validity and versionCode.
echo "5/7 Validando keystore y versionCode contra Play..."
node scripts/require-android-signing.mjs

echo "6/7 Compilando APK release firmado..."
bash android/gradlew -p android assembleRelease --no-daemon

APK="android/app/build/outputs/apk/release/app-release.apk"
[[ -f "$APK" ]] || { echo "ERROR: no se generó $APK" >&2; exit 1; }

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "$SDK" ]] || { echo "ERROR: ANDROID_HOME o ANDROID_SDK_ROOT es obligatorio." >&2; exit 1; }
BUILD_TOOLS=""
while IFS= read -r candidate; do
  if [[ -x "$candidate/apksigner" && -x "$candidate/aapt2" ]]; then BUILD_TOOLS="$candidate"; break; fi
done < <(find "$SDK/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -Vr)
[[ -n "$BUILD_TOOLS" ]] || { echo "ERROR: faltan apksigner/aapt2 en Android SDK." >&2; exit 1; }

EXPECTED="${PIKI_EXPECTED_UPLOAD_CERT_SHA256//:/}"
EXPECTED="${EXPECTED,,}"
SIGNER_OUTPUT="$(${BUILD_TOOLS}/apksigner verify --verbose --print-certs "$APK")"
CERT="$(printf '%s\n' "$SIGNER_OUTPUT" | awk -F': ' '/Signer #1 certificate SHA-256 digest:/ {gsub(":", "", $2); print tolower($2); exit}')"
[[ "$CERT" == "$EXPECTED" ]] || { echo "ERROR: el APK usa otro certificado de subida." >&2; exit 1; }

BADGING="$(${BUILD_TOOLS}/aapt2 dump badging "$APK")"
PACKAGE="$(printf '%s\n' "$BADGING" | sed -n "s/^package: name='\([^']*\)' versionCode='\([^']*\)'.*/\1/p")"
[[ "$PACKAGE" == "com.pikidelivery.riders" ]] || { echo "ERROR: package Android inesperado: $PACKAGE" >&2; exit 1; }

SHA256="$(sha256sum "$APK" | awk '{print $1}')"
SIZE="$(du -h "$APK" | awk '{print $1}')"
echo "7/7 APK firmado y verificado correctamente."
echo "Archivo: $ROOT/$APK"
echo "Paquete: $PACKAGE"
echo "Certificado de subida: $CERT"
echo "SHA-256 APK: $SHA256"
echo "Tamaño: $SIZE"
echo "No se imprimieron contraseñas ni material privado."
