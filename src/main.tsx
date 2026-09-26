import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
      void registration.update()
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

function checkPikiMinimumVersion() {
  const current = "0.2.1";
  const surface = window.location.hostname.split(".")[0] || "unknown";
  const api = "https://api.pikidelivery.com";
  void fetch(`${api}/api/v1/app-version?surface=${encodeURIComponent(surface)}`, { cache: "no-store" })
    .then((r) => r.ok ? r.json() as Promise<{ minimumVersion?: string }> : null)
    .then((v) => {
      if (v?.minimumVersion && v.minimumVersion !== current) {
        document.body.innerHTML = `<main style="font-family:system-ui;padding:32px;max-width:560px;margin:auto"><h1>Actualización obligatoria</h1><p>Hay una nueva versión de PIKI disponible. Recarga para continuar.</p><button style="padding:12px 18px" onclick="location.reload()">Actualizar ahora</button></main>`;
        if ("serviceWorker" in navigator) void navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.update())));
      }
    }).catch(() => undefined);
}
checkPikiMinimumVersion();
