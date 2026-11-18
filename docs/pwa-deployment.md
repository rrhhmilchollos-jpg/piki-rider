# Despliegue y actualización de PIKI Riders PWA

## Dominio de producción

El dominio canónico para acceder e instalar la PWA es **https://rider.pikidelivery.com**, en singular. El build web publica `dist/` en Vercel y utiliza la API HTTPS de **https://api.pikidelivery.com**. Este canal no requiere generar otra APK con PWABuilder.

El subdominio plural no es el dominio de instalación recomendado. El 19 de noviembre de 2026 no resolvía desde la comprobación de producción; no se ha realizado un cambio DNS para restaurarlo.

## Cabeceras de hosting

`vercel.json` configura estas cabeceras:

- `/`, `/sw.js`, `/release.json` y `/manifest.json`: `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`.
- `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`, únicamente para archivos con hash.
- `/sw.js`: `Service-Worker-Allowed: /`.

No añadas `s-maxage` a HTML o archivos de control. Si se utiliza otro CDN delante de Vercel, debe respetar estas cabeceras.

```bash
curl -I https://rider.pikidelivery.com/sw.js
curl -I https://rider.pikidelivery.com/release.json
```

Si se utiliza un Render Static Site en otro despliegue, las reglas equivalentes se configuran en **Static Site → Settings → Headers**. El backend Express de la API no es el hosting de esta PWA.

## Actualización segura

Cada build genera su identificador a partir del commit y un caché `piki-rider-<buildId>`.

1. El navegador descarga el worker nuevo y precarga el shell mínimo.
2. Una actualización espera; `install` no ejecuta `skipWaiting` automáticamente.
3. El cliente comprueba que conoce el estado operativo y que no hay jornada, pedido, autenticación o formulario activo.
4. Cuando es seguro, envía `SKIP_WAITING` al worker en espera.
5. `activate` limpia solo los cachés Rider antiguos, toma el control y notifica a las ventanas. No fuerza su navegación.
6. El cliente vuelve a comprobar la seguridad antes de recargar hacia la versión nueva.

La primera instalación se activa normalmente mediante el navegador. Una comprobación de versión fallida no demuestra ausencia de horarios, cierre de sesión ni conexión GPS. La interfaz ofrece **Reintentar conexión** y **Recargar aplicación** sin interrumpir una operación activa. Los fallos de horarios se muestran por separado y conservan el último estado confirmado.

## Publicar y verificar

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run build
```

Después del despliegue, compara el release y el worker servidos con el commit publicado:

```bash
cat dist/release.json
grep 'BUILD_ID' dist/sw.js
curl -fsSL https://rider.pikidelivery.com/release.json
curl -fsSL https://rider.pikidelivery.com/sw.js | grep BUILD_ID
```

Un build correcto local o un push Git no prueban publicación en Vercel. Tampoco prueban qué versión, sesión, permisos o conexión utiliza cada móvil.

## Recuperar una instalación del dominio anterior

Una PWA instalada mantiene la identidad del origen desde el que se instaló. Sus permisos, almacenamiento y service worker no se comparten automáticamente con otro subdominio. Una recarga que conserva el hostname anterior no lo corrige si ese dominio no resuelve.

Cuando no haya jornada, pedido, cobro ni formulario activo:

1. Abre Chrome y escribe **https://rider.pikidelivery.com**.
2. Usa **Instalar aplicación** o **Añadir a pantalla de inicio** desde ese dominio.
3. Inicia sesión normalmente y vuelve a conceder los permisos necesarios. No copies tokens mediante enlaces, almacenamiento ni mensajes.
4. Comprueba versión, perfil y horarios en la instalación correcta. Durante una jornada autorizada, comprueba el GPS real y la recepción de ofertas.
5. Solo después de comprobarla, retira el icono anterior si lo deseas. No marques opciones que eliminen datos del sitio ni borres los datos del navegador.

Para recuperar enlaces antiguos también puede configurarse un alias con DNS, asociación del dominio en Vercel y TLS válido. Una redirección por sí sola no prueba que se haya migrado la identidad instalada ni la sesión.

Chrome incorpora una migración de origen PWA que requiere autorización en ambos dominios: `migrate_from` en el manifiesto de destino y `allow_migration` en `/.well-known/web-app-origin-association` del origen anterior. El estado oficial de esta función la dirige a escritorio y no documenta su disponibilidad en Android. No debe prometerse que cambie automáticamente el origen de las instalaciones móviles Rider. Además requiere HTTPS operativo en el dominio anterior. No se ha activado esa migración en este proyecto ni se ha forzado un cambio de origen.

Referencia: [Migración de origen PWA en Chrome](https://developer.chrome.com/blog/seamless-pwa-origin-migration).
Compatibilidad: [Estado de la migración PWA en Chromium](https://chromestatus.com/feature/5123349239955456).
