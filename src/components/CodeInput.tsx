import { useEffect, useState } from "react";
import { Input } from "./ui";

/** 6-digit code box used for every emailed code (verification, login, password reset). */
export function CodeInput({ value, onChange, invalid, autoFocus = true }: { value: string; onChange: (v: string) => void; invalid?: boolean; autoFocus?: boolean }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="000000"
      maxLength={6}
      invalid={invalid}
      autoFocus={autoFocus}
      className="text-center font-mono text-2xl tracking-[0.5em]"
      aria-label="6-digit code"
    />
  );
}

/** Seconds left before another code may be requested (the server enforces 30 seconds too). */
export function useCooldown(initial = 30) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return { left, restart: () => setLeft(initial) };
}
