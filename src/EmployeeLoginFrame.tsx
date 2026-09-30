import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import beeMascot from "./assets/piki-bee-scooter.webp";

type Props = { portal: string; children: ReactNode };

export default function EmployeeLoginFrame({ portal, children }: Props) {
  return (
    <section className="piki-login-shell" aria-label={`Acceso seguro PIKI ${portal}`}>
      <header className="piki-login-brandbar">
        <div className="piki-login-brand">
          <img src="/piki-icon-192.png" alt="" aria-hidden="true" />
          <span><strong>PIKI</strong><small>OPERACIONES</small></span>
        </div>
        <span className="piki-login-secure"><i aria-hidden="true" /> ACCESO SEGURO</span>
      </header>
      <div className="piki-login-grid">
        <aside className="piki-login-hero">
          <div className="piki-login-hero-copy">
            <span className="piki-login-kicker"><i aria-hidden="true" /> MOVEMOS PIKI JUNTOS</span>
            <h2>El día va mejor<br />cuando vamos<br /><em>en equipo.</em></h2>
            <p>Tu trabajo hace que cada pedido siga su camino. Entra en tu espacio PIKI y ponte en marcha.</p>
          </div>
          <div className="piki-login-mascot-stage">
            <span className="piki-login-spark piki-login-spark-one" aria-hidden="true">✦</span>
            <span className="piki-login-spark piki-login-spark-two" aria-hidden="true">✦</span>
            <div className="piki-login-halo" aria-hidden="true" />
            <img src={beeMascot} alt="Abeja repartidora de PIKI con casco, scooter amarillo y mochila de reparto." />
            <span className="piki-login-mascot-tag"><i aria-hidden="true" /> RUTA A RUTA, EN EQUIPO</span>
          </div>
          <div className="piki-login-hero-foot"><ShieldCheck size={17} aria-hidden="true" /><span>Tu acceso, protegido. Tu equipo, en marcha.</span></div>
        </aside>
        <div className="piki-login-form-side">{children}</div>
      </div>
      <footer className="piki-login-footer"><span>PIKI</span> · Plataforma de operaciones · {portal}</footer>
    </section>
  );
}
