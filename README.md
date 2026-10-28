# PIKI Rider

Cliente Rider de PIKI construido con React, Vite y TypeScript. El repositorio publica una PWA web y contiene también un shell Android instalable basado en Capacitor. El APK incluye una copia compilada de la interfaz, omite el registro del service worker en la plataforma nativa y no depende de abrir `riders.pikidelivery.com` como PWA para actualizar esa interfaz. Las llamadas operativas siguen necesitando conexión con la API de PIKI.

## Producción

- PWA: `https://riders.pikidelivery.com`
- API central: `https://api.pikidelivery.com`
- Identificador Android: `com.pikidelivery.rider`

## Desarrollo web

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Para cambiar el backend sin modificar código, crea `.env.local`:

```bash
VITE_API_URL=https://api.pikidelivery.com
```

El mapa requiere `VITE_GOOGLE_MAPS_API_KEY` durante el build. La clave debe estar configurada en el entorno de compilación correspondiente y autorizada por Google Cloud; no la guardes en el repositorio.

## Comprobaciones y build web

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run lint
pnpm run build
```

El build publica `dist/`. `scripts/prepare-release.mjs` genera `buildId` en `release.json`, `release-meta.ts` y `sw.js`. Vercel sirve `dist/` conforme a `vercel.json`.

## Android sin depender de PWA

Con Node/pnpm, Java y Android SDK configurados, genera un APK de depuración con:

```bash
pnpm install --frozen-lockfile
pnpm run android:debug
```

El archivo generado es `android/app/build/outputs/apk/debug/app-debug.apk`. Es una build de prueba firmada con la clave debug de Android; no es una release para Google Play. Para distribución pública hace falta una build release firmada con la clave autorizada de PIKI y el canal de actualización que el equipo decida. Los assets de Maps también deben validarse en el origen WebView de la app Android; una clave restringida solo al dominio de la PWA puede no autorizar ese origen.

El shell Android usa Capacitor y empaqueta la interfaz compilada dentro de la aplicación. Un APK nuevo actualiza la interfaz nativa; publicar la PWA en Vercel solo actualiza la versión web. El `codemagic.yaml` actual configura un workflow iOS, no un workflow Android firmado.

## Actualizaciones de la PWA

La PWA instala el contenido de `https://riders.pikidelivery.com` y se actualiza mediante el service worker. `updateViaCache: "none"` instala un caché nuevo por `buildId`, elimina cachés anteriores y activa el worker nuevo. El hosting debe enviar `/`, `/sw.js`, `/release.json` y `/manifest.json` con `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`; la configuración para Vercel está en `vercel.json`. Para más detalles, consulta [`docs/pwa-deployment.md`](docs/pwa-deployment.md).
