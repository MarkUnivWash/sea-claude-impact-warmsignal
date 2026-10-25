"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText,
  className = "",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
