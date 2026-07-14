"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { GitBranch, Loader2, Rocket } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { RevisionStatusPill } from "@/components/ui/status-pill";
import { formatDate } from "@/lib/utils";
import { formatApiError } from "@/lib/errors";
import type { Part, PartRevision } from "@/lib/api-types";

export default function PartDetailPage() {
  const params = useParams<{ id: string }>();
  const { me } = useSession();
  const canEdit = me?.role === "engineer" || me?.role === "admin";
  const utils = trpc.useUtils();

  const { data, isLoading, isError } = trpc.parts.getById.useQuery({ id: params.id });
  const result = data as { part: Part; revisions: PartRevision[] } | undefined;

  const [branchSource, setBranchSource] = useState<string | null>(null);

  const release = trpc.parts.releaseRevision.useMutation({
    onSuccess: () => utils.parts.getById.invalidate({ id: params.id }),
  });
  const [releaseError, setReleaseError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (isError || !result) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-zinc-500">
          Couldn&apos;t load this part. It may not exist, or the API may be unreachable.
        </CardContent>
      </Card>
    );
  }

  const { part, revisions } = result;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Part</p>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          {part.partNumber}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {part.description || "No description"}
          {part.customer ? ` · ${part.customer}` : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Revisions</CardTitle>
            <CardDescription>
              Only the released revision is visible to operators during inspection.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {releaseError ? (
            <p className="border-b border-zinc-100 bg-rose-50 px-5 py-2 text-sm text-rose-700">
              {releaseError}
            </p>
          ) : null}
          <ul className="divide-y divide-zinc-100">
            {revisions.map((rev) => (
              <li key={rev.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-sm font-semibold text-zinc-700">
                    {rev.rev}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/parts/${part.id}/revisions/${rev.id}`}
                        className="text-sm font-medium text-zinc-900 hover:underline"
                      >
                        Revision {rev.rev}
                      </Link>
                      <RevisionStatusPill status={rev.status} />
                    </div>
                    <p className="text-xs text-zinc-500">
                      Created {formatDate(rev.createdAt)}
                      {rev.releasedAt ? ` · Released ${formatDate(rev.releasedAt)}` : ""}
                    </p>
                  </div>
                </div>

                {canEdit ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setBranchSource(rev.id)}
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                      Branch
                    </Button>
                    {rev.status === "draft" ? (
                      <Button
                        size="sm"
                        className="gap-1.5"
                        isLoading={release.isPending && release.variables?.revisionId === rev.id}
                        onClick={() => {
                          setReleaseError(null);
                          release.mutate(
                            { revisionId: rev.id },
                            {
                              onError: (err) =>
                                setReleaseError(
                                  formatApiError(err, "Unable to release revision."),
                                ),
                            },
                          );
                        }}
                      >
                        <Rocket className="h-3.5 w-3.5" />
                        Release
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <Link
                    href={`/parts/${part.id}/revisions/${rev.id}`}
                    className="text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline"
                  >
                    View
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {branchSource ? (
        <BranchRevisionForm
          partId={part.id}
          sourceRevisionId={branchSource}
          onClose={() => setBranchSource(null)}
        />
      ) : null}
    </div>
  );
}

function BranchRevisionForm({
  partId,
  sourceRevisionId,
  onClose,
}: {
  partId: string;
  sourceRevisionId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [newRev, setNewRev] = useState("");
  const [error, setError] = useState<string | null>(null);

  const branch = trpc.parts.branchRevision.useMutation({
    onSuccess: (data: PartRevision) => {
      router.push(`/parts/${partId}/revisions/${data.id}`);
    },
    onError: (err) => {
      setError(formatApiError(err, "Unable to branch revision."));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    branch.mutate({ sourceRevisionId, newRev });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Branch new revision</CardTitle>
          <CardDescription>
            Copies all dimensions from the source revision into a new draft.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="newRev">New revision label</Label>
            <Input
              id="newRev"
              required
              className="w-40"
              value={newRev}
              onChange={(e) => setNewRev(e.target.value.toUpperCase())}
              placeholder="B"
            />
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" isLoading={branch.isPending}>
              Create branch
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
