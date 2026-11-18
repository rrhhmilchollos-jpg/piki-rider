# PIKI Riders PWA

Aplicación de reparto de PIKI desarrollada con React, Vite y TypeScript. El canal web se distribuye como PWA. Las actualizaciones de una PWA se publican en Vercel; una instalación Android nativa, si se utiliza, tiene su propio paquete firmado.

## Producción

- Aplicación e instalación PWA: `https://rider.pikidelivery.com`
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

Abre **`https://rider.pikidelivery.com`**, en singular, en Chrome y usa **Añadir a pantalla de inicio** o **Instalar aplicación**. No generes una APK con PWABuilder para actualizar la PWA.

Si el icono antiguo abre el subdominio plural, instala primero desde el dominio correcto. Inicia sesión normalmente y concede los permisos del nuevo origen. Comprueba que funciona antes de retirar el icono antiguo. No borres los datos del navegador ni transfieras contraseñas o tokens entre dominios. Realiza la recuperación sin jornada, pedido ni formulario activo.

## Actualizaciones automáticas

El service worker usa `updateViaCache: "none"` y cachés por `buildId`. El cliente solicita `SKIP_WAITING` únicamente cuando conoce que no hay una operación activa; las actualizaciones se aplazan durante una jornada, pedido o formulario. El worker no fuerza la navegación de las ventanas durante `activate`.

El hosting debe enviar `/`, `/sw.js`, `/release.json` y `/manifest.json` con `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`. La configuración Vercel está en `vercel.json`; la guía completa está en [`docs/pwa-deployment.md`](docs/pwa-deployment.md).
