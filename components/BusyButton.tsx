"use client";

/** The disabled-while-in-flight button repeated across the trade and granularity tables. */
export function BusyButton({
  busy,
  label,
  busyLabel = "Working…",
  onClick,
  className = "",
}: {
  busy: boolean;
  label: string;
  busyLabel?: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button disabled={busy} onClick={onClick} className={`disabled:opacity-50 ${className}`}>
      {busy ? busyLabel : label}
    </button>
  );
}
