# Despliegue y actualización automática de PIKI Rider PWA

## Qué debe publicarse

El build web publica el contenido de `dist/`. La versión PWA instalada desde `https://riders.pikidelivery.com` recibe contenido del dominio y utiliza el service worker descrito aquí. El proyecto también contiene un shell Android de Capacitor con el bundle de interfaz dentro del APK; ese paquete no se actualiza mediante el service worker ni por una instalación PWA. Para crear un APK de prueba, consulta `README.md` y ejecuta `pnpm run android:debug` con el SDK de Android instalado.

## Cabeceras obligatorias

En el hosting configura estas reglas exactamente:

| Ruta | `Cache-Control` |
| --- | --- |
| `/` | `no-store, no-cache, max-age=0, must-revalidate` |
| `/sw.js` | `no-store, no-cache, max-age=0, must-revalidate` |
| `/release.json` | `no-store, no-cache, max-age=0, must-revalidate` |
| `/manifest.json` | `no-store, no-cache, max-age=0, must-revalidate` |
| `/assets/*` | `public, max-age=31536000, immutable` |

No se debe poner `s-maxage` en las cuatro rutas de control. Si existe Cloudflare delante del hosting, hay que eliminar o sobrescribir cualquier regla que añada `s-maxage=300`.

### Render

Render configura las cabeceras de Static Sites desde el Dashboard. Entra en:

`Static Site → Settings → Headers`

Añade cuatro reglas con las rutas `/`, `/sw.js`, `/release.json` y `/manifest.json`, el nombre `Cache-Control` y el valor `no-store, no-cache, max-age=0, must-revalidate`. Comprueba después con:

```bash
curl -I https://riders.pikidelivery.com/sw.js
curl -I https://riders.pikidelivery.com/release.json
```

La respuesta no debe contener `s-maxage=300`, y debe mostrar el valor anterior de `Cache-Control`.

### Vercel

`vercel.json` ya contiene reglas equivalentes. Si el dominio está detrás de otro proxy, la regla debe existir también en ese proxy porque el último CDN puede sobrescribir la cabecera.

## Cómo funciona el service worker

Cada build genera un `buildId` usando el SHA del commit. Ese identificador forma el nombre del caché:

```text
piki-rider-<buildId>
```

Cuando el navegador detecta un `sw.js` distinto:

1. Descarga el nuevo worker.
2. Ejecuta `install` y precarga el shell mínimo.
3. Ejecuta `skipWaiting()`.
4. Ejecuta `activate`.
5. Borra los cachés `piki-rider-*` antiguos.
6. Ejecuta `clients.claim()`.
7. La interfaz recibe `controllerchange` y recarga una vez para usar el nuevo build.

Los assets compilados de Vite pueden tener caché largo porque sus nombres contienen hash. El documento HTML y los archivos de control no deben tenerlo.

## Publicación recomendada

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run lint
pnpm run build
```

Después de publicar, valida que el identificador sea el mismo en:

```bash
cat dist/release.json
grep 'BUILD_ID' dist/sw.js
curl -fsSL https://riders.pikidelivery.com/release.json
curl -fsSL https://riders.pikidelivery.com/sw.js | grep BUILD_ID
```

Si producción sirve un `buildId` antiguo, el despliegue o el CDN no se han actualizado; no hay que regenerar la aplicación con PWABuilder.

## Recuperación de una instalación antigua

En el móvil, abre directamente `https://riders.pikidelivery.com` en Chrome. Si una instalación vieja continúa mostrando el shell anterior, abre la información del sitio y borra los datos de `riders.pikidelivery.com`; después vuelve a usar **Instalar aplicación**. Esto solo debe ser necesario para instalaciones antiguas que conservaron un service worker previo. Las futuras publicaciones deben actualizarse por sí solas.
