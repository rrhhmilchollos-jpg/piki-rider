# PIKI Partners

Panel web de operaciones para los comercios asociados a **PIKI**. Este repositorio contiene una aplicación React estática conectada exclusivamente a la API central de producción.

## Producción

| Componente | Dirección |
| --- | --- |
| API central | `https://piki-api.onrender.com` |
| Comprobación de disponibilidad | `https://piki-api.onrender.com/ready` |
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
VITE_API_URL=https://piki-api.onrender.com
```

## Despliegue

Render construye el proyecto con `npm ci && npm run build` y publica el directorio `dist`. Cada push a la rama `main` activa un despliegue automático.
