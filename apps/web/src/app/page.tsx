import Link from "next/link";
import {
  ArrowRight,
  ClipboardCheck,
  GitBranch,
  Gauge,
  FileSpreadsheet,
  ShieldCheck,
  Factory,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: ClipboardCheck,
    title: "Digital inspection sheets",
    body: "Operators enter measurements against balloon numbers with instant green / yellow / red feedback — no paper, no transcription errors.",
  },
  {
    icon: Gauge,
    title: "Live Cp / Cpk",
    body: "Process capability recalculates in real time as samples come in, per dimension and per lot, so drift gets caught before it ships.",
  },
  {
    icon: GitBranch,
    title: "Revision-controlled tolerances",
    body: "Draft, release, and branch part revisions with a full audit trail. Operators only ever see the released spec.",
  },
  {
    icon: FileSpreadsheet,
    title: "One-click exports",
    body: "Completed sheets export to CSV, Excel, or PDF for customer submission and internal quality records.",
  },
  {
    icon: ShieldCheck,
    title: "Role-based access",
    body: "Operators, engineers, and admins each get the right level of control — from data entry to spec authoring.",
  },
  {
    icon: Factory,
    title: "Built for the shop floor",
    body: "Large touch targets, fast typeahead part lookup, and a workflow tuned for the inspection station, not the office.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-900 text-sm font-bold text-white">
              DS
            </span>
            <span className="text-base font-semibold tracking-tight">DataSheets</span>
          </div>
          <nav className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/register">
              <Button variant="primary" size="sm">
                Get started
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="max-w-2xl">
            <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200">
              SPC for manufacturing quality teams
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
              Shop-floor inspection sheets that catch drift before it ships.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-600">
              DataSheets replaces paper inspection sheets and spreadsheets with a fast,
              revision-controlled digital workflow — live Cpk, instant disposition
              feedback, and audit-ready exports for every lot.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/register">
                <Button size="lg" className="gap-2">
                  Start free <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" size="lg">
                  Sign in
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Everything quality needs, nothing operators don&apos;t
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-zinc-200 p-6 transition-shadow hover:shadow-panel"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 text-white">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-zinc-900">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-zinc-900">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-14 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-semibold text-white">
                Get your inspection floor off paper this week.
              </h2>
              <p className="mt-2 max-w-lg text-sm text-zinc-400">
                Create a company, define your first part revision, and run your first
                digital lot inspection in minutes.
              </p>
            </div>
            <Link href="/register">
              <Button size="lg" variant="secondary" className="gap-2 whitespace-nowrap">
                Create your company <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 bg-white py-8">
        <div className="mx-auto max-w-6xl px-6 text-xs text-zinc-400">
          © {new Date().getFullYear()} DataSheets. Built for the shop floor.
        </div>
      </footer>
    </div>
  );
}
