"use client";

import { useMemo } from "react";
import { FileWarning } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PdfPreviewProps {
  /** Blob URL, data URL, or remote PDF URL. */
  src?: string | null;
  /** Raw base64 PDF bytes (without data: prefix). */
  base64?: string | null;
  title?: string;
  className?: string;
  height?: number | string;
}

function toPdfSrc(src?: string | null, base64?: string | null): string | null {
  if (src?.trim()) return src.trim();
  if (base64?.trim()) {
    const cleaned = base64.trim().replace(/^data:application\/pdf;base64,/i, "");
    return `data:application/pdf;base64,${cleaned}`;
  }
  return null;
}

export function PdfPreview({
  src,
  base64,
  title = "PDF preview",
  className,
  height = 480,
}: PdfPreviewProps) {
  const pdfSrc = useMemo(() => toPdfSrc(src, base64), [src, base64]);
  const heightStyle = typeof height === "number" ? `${height}px` : height;

  if (!pdfSrc) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-6 py-12 text-center",
          className,
        )}
        style={{ minHeight: heightStyle }}
      >
        <FileWarning className="h-8 w-8 text-zinc-300" />
        <p className="text-sm font-medium text-zinc-600">PDF preview unavailable</p>
        <p className="max-w-sm text-xs text-zinc-400">
          No PDF source was provided, or the file could not be loaded.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 shadow-panel",
        className,
      )}
    >
      <iframe
        src={pdfSrc}
        title={title}
        className="w-full border-0 bg-white"
        style={{ height: heightStyle }}
        // Built-in PDF viewers need same-origin + scripts; no forms/popups/top-nav.
        sandbox="allow-same-origin allow-scripts"
      />
    </div>
  );
}
