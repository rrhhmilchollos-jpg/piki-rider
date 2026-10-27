# PIKI Riders PWA

Aplicación web progresiva (PWA) para riders de PIKI. El proyecto es únicamente web: React + Vite + TypeScript. No contiene Android, iOS ni Capacitor.

## Producción

- Aplicación: `https://riders.pikidelivery.com`
- API central: `https://api.pikidelivery.com`

## Desarrollo local

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Para cambiar el backend sin modificar código, crea `.env.local`:

```bash
VITE_API_URL=https://api.pikidelivery.com
```

## Build y despliegue

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run lint
pnpm run build
```

El despliegue publica `dist/`. Cada build ejecuta `scripts/prepare-release.mjs`, que genera el `buildId` del commit en `release.json`, `release-meta.ts` y `sw.js`.

## Instalación en el móvil

Abre `https://riders.pikidelivery.com` en Chrome y usa **Añadir a pantalla de inicio** o **Instalar aplicación**. La aplicación instalada es la PWA del dominio; no se debe generar ni instalar una APK con PWABuilder para actualizar el contenido web.

## Actualizaciones automáticas

El service worker se registra con `updateViaCache: "none"`, instala un caché nuevo por `buildId`, elimina los cachés anteriores y activa el nuevo worker con `skipWaiting()` y `clients.claim()`. El hosting debe enviar `/`, `/sw.js`, `/release.json` y `/manifest.json` con `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`.

La configuración equivalente para Vercel está en `vercel.json`. Si el dominio se sirve desde Render, añade esas cuatro reglas en **Render Dashboard → Static Site → Headers**. La guía completa está en [`docs/pwa-deployment.md`](docs/pwa-deployment.md).
