"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { setToken } from "@/lib/auth";
import { formatApiError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = trpc.auth.login.useMutation({
    onSuccess: (data: { token: string }) => {
      setToken(data.token);
      router.push("/dashboard");
    },
    onError: (err) => {
      setError(formatApiError(err, "Unable to sign in. Check your credentials and try again."));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    login.mutate({ email, password });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f8f7] px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-900 text-sm font-bold text-white">
            DS
          </span>
          <span className="text-base font-semibold tracking-tight">DataSheets</span>
        </Link>

        <div className="rounded-xl border border-zinc-200 bg-white p-7 shadow-panel">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Sign in</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Enter your credentials to access your company&apos;s inspection floor.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error ? (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" isLoading={login.isPending}>
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Don&apos;t have a company yet?{" "}
          <Link href="/register" className="font-medium text-zinc-900 hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
