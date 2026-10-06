import { useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  detail?: string;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  compact?: boolean;
};

const COMPLETION_VALUE = 96;

/** A keyboard-accessible slider that requires an intentional full swipe. */
export default function SlideToConfirm({ label, detail, disabled = false, busy = false, onConfirm, compact = false }: Props) {
  const [value, setValue] = useState(0);
  const confirmedRef = useRef(false);

  useEffect(() => {
    if (disabled || busy) setValue(0);
  }, [busy, disabled]);

  const update = (nextValue: number) => {
    if (disabled || busy || confirmedRef.current) return;
    setValue(nextValue);
    if (nextValue < COMPLETION_VALUE) return;
    confirmedRef.current = true;
    setValue(100);
    onConfirm();
    window.setTimeout(() => {
      confirmedRef.current = false;
      setValue(0);
    }, 450);
  };

  return <div className={`slide-confirm ${compact ? "is-compact" : ""} ${disabled ? "is-disabled" : ""} ${busy ? "is-busy" : ""}`}>
    <div className="slide-confirm-copy">
      <strong>{busy ? "Confirmando…" : label}</strong>
      {detail && <small>{detail}</small>}
    </div>
    <div className="slide-confirm-track">
      <span className="slide-confirm-fill" style={{ width: `${value}%` }} aria-hidden="true" />
      <span className="slide-confirm-hint" aria-hidden="true">desliza para confirmar →</span>
      <input
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="slide-confirm-range"
        disabled={disabled || busy}
        max="100"
        min="0"
        onChange={(event) => update(Number(event.currentTarget.value))}
        onPointerUp={(event) => { if (Number((event.currentTarget as HTMLInputElement).value) < COMPLETION_VALUE) setValue(0); }}
        onTouchEnd={(event) => { if (Number((event.currentTarget as HTMLInputElement).value) < COMPLETION_VALUE) setValue(0); }}
        step="1"
        type="range"
        value={value}
      />
    </div>
  </div>;
}
