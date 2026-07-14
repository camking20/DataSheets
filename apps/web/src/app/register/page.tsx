"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { setToken } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import { formatApiError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verifyEmail = trpc.auth.verifyEmail.useMutation();
  const login = trpc.auth.login.useMutation();

  const register = trpc.auth.register.useMutation({
    onSuccess: async (data: {
      emailVerificationRequired?: boolean;
      devVerificationToken?: string;
      user: { email: string };
    }) => {
      try {
        // Local/dev: auto-verify with the returned token, then sign in.
        if (data.devVerificationToken) {
          await verifyEmail.mutateAsync({ token: data.devVerificationToken });
          const session = await login.mutateAsync({
            email: data.user.email,
            password,
          });
          setToken(session.token);
          router.push("/dashboard");
          return;
        }
        setError(
          "Account created. Check your email to verify before signing in.",
        );
      } catch (err) {
        setError(
          formatApiError(
            err,
            "Account created, but verification failed. Try signing in after verifying your email.",
          ),
        );
      }
    },
    onError: (err) => {
      setError(formatApiError(err, "Unable to create your company. Please try again."));
    },
  });

  function handleCompanyNameChange(value: string) {
    setCompanyName(value);
    if (!slugTouched) setCompanySlug(slugify(value));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    register.mutate({
      name,
      email,
      password,
      companyName,
      companySlug,
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f8f7] px-6 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-900 text-sm font-bold text-white">
            DS
          </span>
          <span className="text-base font-semibold tracking-tight">DataSheets</span>
        </Link>

        <div className="rounded-xl border border-zinc-200 bg-white p-7 shadow-panel">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
            Create your company
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Set up your inspection floor and admin account in under a minute.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="companyName">Company name</Label>
                <Input
                  id="companyName"
                  required
                  value={companyName}
                  onChange={(e) => handleCompanyNameChange(e.target.value)}
                  placeholder="Acme Precision Co."
                />
              </div>
              <div>
                <Label htmlFor="companySlug">Company slug</Label>
                <Input
                  id="companySlug"
                  required
                  pattern="[a-z0-9-]+"
                  value={companySlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setCompanySlug(slugify(e.target.value));
                  }}
                  placeholder="acme-precision"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan Rivera"
              />
            </div>
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
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
              />
            </div>

            {error ? (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              isLoading={
                register.isPending || verifyEmail.isPending || login.isPending
              }
            >
              Create company &amp; account
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-zinc-900 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
