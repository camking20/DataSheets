"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

const SHA256_HEX = /^[a-fA-F0-9]{64}$/;

export interface SignatureModalProps {
  open: boolean;
  onClose: () => void;
  /** Human-readable meaning, e.g. "ME Approval". Prefer MEANING_LABELS / meaningLabel(). */
  meaningLabel: string;
  /** Short description of what is being signed. */
  entitySummary: string;
  /**
   * Server-provided content SHA-256 (64-char hex). Required.
   * Parent obtains this from the API — do not hash client strings in this modal.
   */
  contentSha256: string;
  /** Parent posts password (+ contentSha256) to the signing API. */
  onSign: (input: { password: string }) => void | Promise<void>;
  className?: string;
}

export function SignatureModal({
  open,
  onClose,
  meaningLabel,
  entitySummary,
  contentSha256,
  onSign,
  className,
}: SignatureModalProps) {
  const { me } = useSession();
  const printedName = me?.user.name?.trim() || me?.user.email || "—";

  const [password, setPassword] = useState("");
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setAttested(false);
    setError(null);
    setSubmitting(false);
  }, [open]);

  if (!open) return null;

  const hashReady = SHA256_HEX.test(contentSha256.trim());
  const canSubmit = password.length > 0 && attested && hashReady && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSign({ password });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to apply signature.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-zinc-900/40 backdrop-blur-[1px]"
        aria-label="Close signature dialog"
        onClick={onClose}
        disabled={submitting}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-modal-title"
        className={cn(
          "relative z-10 w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-xl",
          className,
        )}
      >
        <form onSubmit={handleSubmit}>
          <div className="border-b border-zinc-100 px-5 py-4">
            <h2
              id="signature-modal-title"
              className="text-sm font-semibold tracking-tight text-zinc-900"
            >
              Electronic signature
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{meaningLabel}</p>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Signing
              </p>
              <p className="mt-1 text-sm text-zinc-800">{entitySummary}</p>
              <p className="mt-2 break-all font-mono text-[11px] text-zinc-400">
                SHA-256: {contentSha256}
              </p>
              {!hashReady ? (
                <p className="mt-1 text-xs text-amber-600">
                  Waiting for server content hash…
                </p>
              ) : null}
            </div>

            <div>
              <Label>Printed name</Label>
              <div className="flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-800">
                {printedName}
              </div>
            </div>

            <div>
              <Label htmlFor="signature-password">Password</Label>
              <Input
                id="signature-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Confirm your password"
                disabled={submitting}
                autoFocus
              />
            </div>

            <label className="flex cursor-pointer gap-2.5 text-sm text-zinc-600">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                disabled={submitting}
              />
              <span>
                I understand this is my electronic signature and that it is legally
                binding and equivalent to my handwritten signature under applicable
                regulations (including 21 CFR Part 11 intent).
              </span>
            </label>

            {error ? (
              <p className="text-sm text-rose-600" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} isLoading={submitting}>
              Sign
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
