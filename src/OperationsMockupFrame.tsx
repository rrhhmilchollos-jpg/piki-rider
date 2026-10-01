export default function OperationsMockupFrame({ label = "Pedidos y mapa operativo" }: { label?: string }) {
  return <section className="operations-mockup-frame" aria-label={label}>
    <div className="operations-mockup-head"><div><p className="eyebrow">PIKI · REDISEÑO OPERATIVO</p><h2>{label}</h2><span>Vista visual compartida con el nuevo centro de operaciones.</span></div><span className="operations-mockup-badge">PREVIEW UI</span></div>
    <iframe title={label} src="/mockups/pedidos-mapa.html?embed=1" loading="lazy" />
  </section>;
}
