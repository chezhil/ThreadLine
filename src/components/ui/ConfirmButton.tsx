"use client";
import { useState } from "react";
import { Button, type ButtonProps } from "./Button";

export interface ConfirmButtonProps extends Omit<ButtonProps, "onClick"> {
  /** What the first click says, e.g. "Delete". */
  label: string;
  /** What the second click says, e.g. "Confirm delete". */
  confirmLabel: string;
  /** Runs on the second click; returns an error message to show, or null. */
  onConfirm: () => Promise<string | null>;
}

/**
 * A destructive or hard-to-undo action that takes two clicks: the first arms
 * it (with a Cancel next to it), the second runs it. While it runs the button
 * is disabled, so a double-click can't fire it twice; a refusal (say, a 409
 * "has 3 orders") is shown next to it.
 */
export function ConfirmButton({ label, confirmLabel, onConfirm, variant = "ghost", size = "sm", disabled, ...props }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    const message = await onConfirm();
    setBusy(false);
    setArmed(false);
    setError(message);
  }

  if (!armed) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={disabled}
          onClick={() => {
            setError(null);
            setArmed(true);
          }}
          {...props}
        >
          {label}
        </Button>
        {error && (
          <span role="alert" className="max-w-xs whitespace-normal text-right text-xs text-red-700">
            {error}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button type="button" variant="danger" size={size} disabled={busy} onClick={run}>
        {busy ? "Working…" : confirmLabel}
      </Button>
      <Button type="button" variant="ghost" size={size} disabled={busy} onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}
