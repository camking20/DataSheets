import { Loader2 } from "lucide-react";

export default function DocumentDetailLoading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
    </div>
  );
}
