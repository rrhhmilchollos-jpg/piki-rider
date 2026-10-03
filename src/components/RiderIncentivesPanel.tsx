import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BadgeEuro, Gift, Handshake, LoaderCircle, MapPinned, RefreshCw, ShieldCheck, Users } from "lucide-react";
import "./RiderIncentivesPanel.css";
import { claimRiderReferralCode, loadRiderIncentives, type RiderIncentiveSnapshot } from "../integrations/piki-api";

function euro(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function describeEntry(type: string) {
  if (type === "acquisition_bonus") return "Bono por primeras entregas";
  if (type === "referral_bonus") return "Bono por invitar a un Rider";
  if (type === "referred_rider_bonus") return "Bono por completar el reto de entregas";
  if (type === "hourly_guarantee") return "Complemento de garantía por turno";
  return "Incentivo PIKI";
}

export default function RiderIncentivesPanel({ token, riderId }: { token: string; riderId: string }) {
  const [snapshot, setSnapshot] = useState<RiderIncentiveSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimCode, setClaimCode] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const refresh = useCallback(async () => {
    if (!token || !riderId) return;
    setBusy(true);
    try {
      setSnapshot(await loadRiderIncentives(token, riderId));
      setIsError(false);
    } catch {
      setIsError(true);
      setMessage("No se pudieron cargar los incentivos. Comprueba la conexión y vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }, [token, riderId]);

  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  const copyCode = async () => {
    const code = snapshot?.referral?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setMessage("Código copiado. Compártelo con el Rider que invites.");
      setIsError(false);
    } catch {
      setMessage(`Tu código: ${code}`);
      setIsError(false);
    }
  };

  const shareCode = async () => {
    const code = snapshot?.referral?.code;
    if (!code) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Invitación PIKI Riders", text: `Únete a PIKI Riders con mi código ${code}.` });
        return;
      } catch { /* El Rider puede cancelar el selector del sistema sin efecto. */ }
    }
    await copyCode();
  };

  const submitClaim = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!claimCode.trim() || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await claimRiderReferralCode(token, riderId, claimCode.trim());
      setClaimCode("");
      setMessage("Código asociado. El progreso se contará con entregas completadas y confirmadas.");
      setIsError(false);
      await refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "No se pudo asociar el código.";
      const friendly = text.includes("REFERRAL_CODE_CLAIM_CLOSED") ? "El código debe asociarse antes de completar la primera entrega."
        : text.includes("SELF_REFERRAL_NOT_ALLOWED") ? "No puedes asociar tu propio código."
          : text.includes("REFERRAL_CODE_NOT_FOUND") ? "No encontramos ese código de invitación."
            : text.includes("REFERRAL_ALREADY_CLAIMED") ? "Ya tienes un código asociado."
              : "No se pudo asociar el código. Comprueba que el programa esté activo y vuelve a intentarlo.";
      setMessage(friendly);
      setIsError(true);
    } finally {
      setBusy(false);
    }
  };

  const policy = snapshot?.program.policy;
  const referralActive = Boolean(snapshot?.program.referralsEnabled);
  const guaranteeActive = Boolean(snapshot?.program.hourlyGuaranteeEnabled);

  return <section className="feature-section incentive-page">
    <header className="incentive-heading">
      <div className="incentive-icon"><Gift size={22}/></div>
      <div><p className="eyebrow">PIKI · INCENTIVOS</p><h1>Bonos y garantía de turno</h1><p className="lead">Condiciones transparentes; solo cuentan entregas confirmadas por la plataforma.</p></div>
      <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={busy} aria-label="Actualizar incentivos"><RefreshCw size={16}/> Actualizar</button>
    </header>
    {message && <p className={isError ? "form-error" : "form-success"} role="status">{message}</p>}
    {!snapshot && busy && <div className="incentive-loading"><LoaderCircle className="spin" size={20}/> Cargando el programa…</div>}
    {!snapshot && isError && <p className="empty-copy">El programa de incentivos no está disponible ahora.</p>}
    {snapshot && <>
      <div className="incentive-status-grid">
        <article className="incentive-card">
          <div className="incentive-card-title"><BadgeEuro size={19}/><h2>Garantía por hora</h2></div>
          <span className={`incentive-status ${guaranteeActive ? "is-active" : "is-inactive"}`}>{guaranteeActive ? "Programa activo" : "Pendiente de activación"}</span>
          <p>Hasta {euro(policy?.hourlyRateCents || 700)} por hora, para un turno completo de {policy?.requiredShiftHours || 4} horas. En cuatro horas, el suelo previsto es {euro((policy?.hourlyRateCents || 700) * (policy?.requiredShiftHours || 4))}; se complementan las entregas solo hasta ese importe.</p>
          <ul className="incentive-conditions"><li><MapPinned size={15}/> Zona operativa: {policy?.centralZoneSlug || "zona central"}</li><li><ShieldCheck size={15}/> Aceptación mínima: {Math.round((policy?.minimumAcceptanceRate || 0.95) * 100)} % de ofertas</li><li><Handshake size={15}/> Turno completo conectado y ubicaciones válidas</li></ul>
          {!guaranteeActive && <small>La garantía no genera pagos mientras la plataforma no active el programa y su presupuesto mensual. Los requisitos se verifican en el servidor, no desde este móvil.</small>}
          {snapshot.guarantee.currentShift && <div className="incentive-shift-progress"><strong>Turno actual</strong><span>{snapshot.guarantee.currentShift.startTime}–{snapshot.guarantee.currentShift.endTime} · {snapshot.guarantee.currentShift.sampleCount} muestras de ubicación</span><small>Zona central: {snapshot.guarantee.currentShift.centralZoneOk === null ? "aún sin verificar" : snapshot.guarantee.currentShift.centralZoneOk ? "sin incidencias registradas" : "no cumple por ahora"}</small></div>}
        </article>
        <article className="incentive-card">
          <div className="incentive-card-title"><Users size={19}/><h2>Plan Amigo</h2></div>
          <span className={`incentive-status ${referralActive ? "is-active" : "is-inactive"}`}>{referralActive ? "Programa activo" : "Pendiente de activación"}</span>
          <p>Al completar las primeras 5 entregas confirmadas, el nuevo Rider obtiene {euro(policy?.acquisitionBonusCents || 2000)}. Con 20 entregas, ambos reciben además {euro(policy?.referralBonusCents || 1500)}.</p>
          {referralActive && snapshot.referral?.code && <div className="incentive-code-block"><span>Tu código único</span><strong>{snapshot.referral.code}</strong><div><button type="button" className="secondary-button" onClick={() => void copyCode()}>Copiar</button><button type="button" className="primary-button" onClick={() => void shareCode()}>Compartir</button></div></div>}
          {referralActive && snapshot.referral?.eligibleToClaim && <form className="incentive-claim-form" onSubmit={(event) => void submitClaim(event)}><label htmlFor="rider-referral-code">¿Te invitó otro Rider? Asocia su código antes de tu primera entrega.</label><div><input id="rider-referral-code" value={claimCode} onChange={(event) => setClaimCode(event.target.value.toUpperCase())} maxLength={32} placeholder="PIKI-XXXXXXXX" autoComplete="off"/><button className="secondary-button" disabled={busy || !claimCode.trim()} type="submit">Asociar</button></div></form>}
          {snapshot.referral?.completedDeliveries !== undefined && <div className="incentive-progress"><span>Entregas confirmadas</span><strong>{snapshot.referral.completedDeliveries}</strong><small>{snapshot.referral.acquisitionProgress}/{snapshot.referral.acquisitionTarget} para el bono inicial{snapshot.referral.referralTarget ? ` · ${snapshot.referral.referralProgress}/${snapshot.referral.referralTarget} para el bono por referido` : ""}</small></div>}
          {!referralActive && <small>Los códigos y bonos se habilitarán cuando el equipo active la campaña y su límite de gasto. La atribución se bloquea después de la primera entrega y no admite autocódigos.</small>}
        </article>
      </div>
      <article className="incentive-wallet-card"><div><div className="incentive-card-title"><BadgeEuro size={19}/><h2>Bonos registrados</h2></div><p>Importes devengados por hitos verificados. Esta vista no sustituye la liquidación ni confirma un pago bancario.</p></div><strong>{euro(snapshot.wallet.earnedCents)}</strong></article>
      {snapshot.wallet.entries.length > 0 && <section className="incentive-history"><h2>Actividad reciente</h2>{snapshot.wallet.entries.slice(0, 10).map((entry) => <article key={entry._id}><div><strong>{describeEntry(entry.entryType)}</strong><small>{new Date(entry.createdAt).toLocaleDateString("es-ES")} · {entry.status === "earned" ? "Pendiente de liquidación" : entry.status === "paid" ? "Liquidado" : "Anulado"}</small></div><b>{euro(entry.amountCents)}</b></article>)}</section>}
      <footer className="incentive-budget-note">Límite de campaña configurado: {euro(snapshot.program.monthlyCapCents)} al mes · comprometido este mes: {euro(snapshot.program.budgetCommittedCents || 0)} · disponible: {euro(snapshot.program.budgetRemainingCents || 0)}. Los bonos se asignan una sola vez y dependen del presupuesto aprobado.</footer>
    </>}
  </section>;
}
