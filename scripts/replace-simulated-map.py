from pathlib import Path

p = Path('/home/ubuntu/piki-rider/src/App.tsx')
s = p.read_text()
s = s.replace('import EmployeeAuthGate from "./EmployeeAuthGate";', 'import EmployeeAuthGate from "./EmployeeAuthGate";\nimport LiveGoogleMap from "./components/LiveGoogleMap";')
s = s.replace('if (shiftActive) return <ActiveShiftView onMenu={() => setOpen(true)} onSupport={() => showSection("Soporte")} onStop={toggleShift} toast={toast} />;', 'if (shiftActive) return <ActiveShiftView token={apiToken} riderId={riderId} onMenu={() => setOpen(true)} onSupport={() => showSection("Soporte")} onStop={toggleShift} toast={toast} onError={setToast} />;')
start = s.index('function ActiveShiftView(')
end = s.index('\nfunction FeatureHeading', start)
replacement = '''function ActiveShiftView({ token, riderId, onMenu, onSupport, onStop, toast, onError }: { token: string; riderId: string; onMenu: () => void; onSupport: () => void; onStop: () => void; toast: string; onError: (message: string) => void }) {
  return <main className="active-shift-shell">
    <section className="active-map real-google-map-section" aria-label="Google Maps operativo en vivo">
      <LiveGoogleMap token={token} riderId={riderId} onError={onError} />
      <button className="active-menu-button" onClick={onMenu} aria-label="Abrir menú"><Menu size={25}/></button>
      <div className="online-pill"><span className="online-dot"/><span>Estado</span><strong>En línea</strong></div>
      <button className="active-help-button" onClick={onSupport} aria-label="Abrir soporte"><Headphones size={24}/></button>
      <section className="active-bottom-sheet"><p className="active-eyebrow">PIKI · JORNADA ACTIVA</p><h1>Mapa en vivo</h1><p>Google Maps muestra tu posición, la zona asignada y sus delimitaciones reales.</p><div className="active-sheet-actions"><button onClick={onStop} className="active-stop-button"><Power size={17}/> Finalizar jornada</button><button onClick={onSupport} className="active-support-button"><Headphones size={17}/> Soporte</button></div></section>
    </section>
    {toast && <div className="toast active-toast" role="status"><ShieldCheck size={17}/>{toast}</div>}
  </main>;
}
'''
s = s[:start] + replacement + s[end:]
p.write_text(s)

css = Path('/home/ubuntu/piki-rider/src/App.css')
css.write_text(css.read_text() + '''
/* Google Maps real: no se usan mapas dibujados ni datos simulados. */
.real-google-map-section{position:relative;background:#e8eef3}
.real-map-shell{position:absolute;inset:0}
.google-map-canvas{position:absolute;inset:0;min-height:100%;background:#e8eef3}
.real-map-status{position:absolute;left:50%;top:92px;transform:translateX(-50%);display:flex;gap:12px;align-items:center;z-index:4;padding:9px 14px;border-radius:16px;background:#111;color:#fff;font-size:12px;white-space:nowrap;box-shadow:0 5px 14px rgba(0,0,0,.25)}
.real-map-status strong{color:#c9f36d}
.gps-dot{width:9px;height:9px;border-radius:50%;background:#84cc16;box-shadow:0 0 0 4px rgba(132,204,22,.18)}
''')
