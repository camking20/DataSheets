"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, HardDrive, Loader2, Unplug } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<IntegrationsLoading />}>
      <IntegrationsContent />
    </Suspense>
  );
}

function IntegrationsLoading() {
  return (
    <div className="mx-auto flex max-w-2xl items-center justify-center py-24">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
    </div>
  );
}

function googleErrorHelp(reason: string | null): string {
  switch (reason) {
    case "drive_api_disabled":
      return "Enable the Google Drive API for this Cloud project (APIs & Services → Library → Google Drive API → Enable), then try again.";
    case "redirect_uri_mismatch":
      return "Redirect URI mismatch. In Google Cloud credentials, Authorized redirect URIs must include exactly: http://localhost:4000/google/oauth/callback";
    case "invalid_client":
      return "Invalid OAuth client. Double-check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the repo-root .env, then restart the API.";
    case "token_exchange":
      return "Google rejected the token exchange. Confirm the Client ID/Secret match this OAuth client, and that the redirect URI is exact.";
    case "invalid_state":
      return "The sign-in session expired or the API restarted mid-connect. Click Connect again.";
    case "access_denied":
      return "Access was denied in Google’s consent screen. If the app is in Testing, add your Google account as a Test user.";
    case "provision_failed":
      return "Signed in, but creating the company Drive folders failed. Ensure Drive API is enabled and try again.";
    case "encrypt_failed":
      return "APP_ENCRYPTION_KEY is invalid. It must be a 64-character hex string (openssl rand -hex 32).";
    default:
      return reason
        ? `Something went wrong (${reason}). Try connecting again.`
        : "Something went wrong. Try connecting again.";
  }
}

function IntegrationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { me } = useSession();
  const isAdmin = me?.role === "admin";

  const [showConnectedBanner, setShowConnectedBanner] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const connectionQuery = trpc.google.getConnection.useQuery();
  const connection = connectionQuery.data;

  const utils = trpc.useUtils();
  const getAuthUrl = trpc.google.getAuthUrl.useMutation();
  const disconnect = trpc.google.disconnect.useMutation();

  useEffect(() => {
    if (searchParams.get("google") !== "connected") return;
    setShowConnectedBanner(true);
    router.replace("/settings/integrations", { scroll: false });
  }, [searchParams, router]);

  async function handleConnect() {
    setActionError(null);
    try {
      const result = await getAuthUrl.mutateAsync();
      window.location.href = result.url;
    } catch (err) {
      setActionError(formatApiError(err, "Could not start Google connection."));
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect Google Drive for this company? Document editing will stop until you reconnect.")) {
      return;
    }
    setActionError(null);
    try {
      await disconnect.mutateAsync();
      setShowConnectedBanner(false);
      await utils.google.getConnection.invalidate();
    } catch (err) {
      setActionError(formatApiError(err, "Could not disconnect Google Drive."));
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Integrations</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Connect external services used for document control and collaboration.
        </p>
      </div>

      {showConnectedBanner ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Google Drive connected</p>
            <p className="mt-0.5 text-emerald-700">
              Your company Drive folder is ready. Controlled documents will live there.
            </p>
          </div>
        </div>
      ) : null}

      {searchParams.get("google") === "error" ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <p className="font-medium">Google connection failed</p>
          <p className="mt-1 text-rose-700">
            {googleErrorHelp(searchParams.get("reason"))}
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
              <HardDrive className="h-5 w-5 text-zinc-700" />
            </span>
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Google Drive
                {connectionQuery.isLoading ? null : connection?.connected ? (
                  <Badge tone="emerald">Connected</Badge>
                ) : (
                  <Badge tone="neutral">Not connected</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Controlled documents live in your company&apos;s Google Drive. DataSheets uses
                the <span className="font-medium text-zinc-600">drive.file</span> scope so it can
                only access files and folders it creates.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {connectionQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking connection…
            </div>
          ) : connectionQuery.isError ? (
            <p className="text-sm text-zinc-500">
              Couldn&apos;t load Google connection status. Check that the API is running.
            </p>
          ) : connection?.connected ? (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Account
                </dt>
                <dd className="mt-0.5 font-medium text-zinc-900">
                  {connection.accountEmail ?? "Connected (email unavailable)"}
                </dd>
              </div>
              {connection.connectedAt ? (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Connected
                  </dt>
                  <dd className="mt-0.5 text-zinc-600">
                    {formatDateTime(connection.connectedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <div className="space-y-3 text-sm text-zinc-500">
              <p>
                {isAdmin
                  ? "Connect a Google account so drafts and revisions can be edited in Drive."
                  : "Ask a company admin to connect Google Drive."}
              </p>
              {isAdmin ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs leading-relaxed text-zinc-600">
                  <p className="font-medium text-zinc-800">Server setup (once)</p>
                  <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                    <li>
                      Create an OAuth client in{" "}
                      <a
                        href="https://console.cloud.google.com/apis/credentials"
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-zinc-800 underline-offset-2 hover:underline"
                      >
                        Google Cloud Console
                      </a>
                      .
                    </li>
                    <li>
                      Set redirect URI to{" "}
                      <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-zinc-800">
                        http://localhost:4000/google/oauth/callback
                      </code>
                    </li>
                    <li>
                      Put <code className="font-mono text-[11px]">GOOGLE_CLIENT_ID</code>,{" "}
                      <code className="font-mono text-[11px]">GOOGLE_CLIENT_SECRET</code>, and{" "}
                      <code className="font-mono text-[11px]">APP_ENCRYPTION_KEY</code> in the
                      repo-root <code className="font-mono text-[11px]">.env</code>, then restart
                      the API.
                    </li>
                  </ol>
                </div>
              ) : null}
            </div>
          )}

          {actionError ? (
            <p className="text-sm text-rose-600">{actionError}</p>
          ) : null}
        </CardContent>

        {isAdmin ? (
          <CardFooter className="justify-end gap-2">
            {connection?.connected ? (
              <Button
                variant="destructive"
                onClick={handleDisconnect}
                isLoading={disconnect.isPending}
                className="gap-2"
              >
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            ) : (
              <Button
                onClick={handleConnect}
                isLoading={getAuthUrl.isPending}
                disabled={connectionQuery.isLoading || connectionQuery.isError}
              >
                Connect Google Drive
              </Button>
            )}
          </CardFooter>
        ) : null}
      </Card>

      <p className="text-xs leading-relaxed text-zinc-400">
        After connecting, DataSheets creates a company folder tree in Drive. Operators and
        engineers do not need their own OAuth consent — editors open Google Docs while signed
        into an account with access to that Drive.
      </p>
    </div>
  );
}
