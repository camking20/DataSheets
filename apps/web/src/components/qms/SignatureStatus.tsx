import { CheckCircle2, PenLine } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";

export interface SignatureStatusSigner {
  signerName?: string | null;
  signedAt?: string | Date | null;
}

export interface SignatureStatusProps {
  label: string;
  done: boolean;
  signer?: SignatureStatusSigner;
  /** Shown when not yet signed. Default: "Awaiting signature". */
  pendingMessage?: string;
  className?: string;
}

export function SignatureStatus({
  label,
  done,
  signer,
  pendingMessage = "Awaiting signature",
  className,
}: SignatureStatusProps) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        done
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-amber-200 bg-amber-50/50",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <PenLine className="h-4 w-4 text-amber-600" />
        )}
        <span className="text-sm font-medium text-zinc-900">{label}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {done
          ? `${signer?.signerName?.trim() || "Signed"} · ${formatDateTime(signer?.signedAt)}`
          : pendingMessage}
      </p>
    </div>
  );
}
