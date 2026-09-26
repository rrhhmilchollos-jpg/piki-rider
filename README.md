# PIKI Partners

Panel web de operaciones para los comercios asociados a **PIKI**. Este repositorio contiene una aplicación React estática conectada exclusivamente a la API central de producción.

## Producción

| Componente | Dirección |
| --- | --- |
| API central | `https://api.pikidelivery.com` |
| Comprobación de disponibilidad | `https://api.pikidelivery.com/ready` |
| Panel temporal de Render | `https://piki-partners.onrender.com` |
| Dominio objetivo | `https://partners.piki.es` |

## Funcionalidad inicial

El panel verifica en tiempo real la disponibilidad de la API y PostgreSQL mediante `/ready`. También permite enviar solicitudes de alta de comercios al endpoint `POST /api/v1/partners/onboarding`.

## Desarrollo local

```bash
npm install
npm run dev
```

Para cambiar el backend sin modificar código, crea un archivo `.env.local`:

```bash
VITE_API_URL=https://api.pikidelivery.com
```

## Despliegue

Render construye el proyecto con `npm ci && npm run build` y publica el directorio `dist`. Cada push a la rama `main` activa un despliegue automático.
