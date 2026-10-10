"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Factory, Landmark, Truck } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { BrandMark } from "@/components/layout/BrandMark";

const PILLARS = [
  { icon: Factory, title: "Loom shed telemetry", body: "Every loom's status and output, pushed live." },
  { icon: ClipboardCheck, title: "Roll-level quality", body: "QR-tagged rolls, QC verdicts and defect outliers." },
  { icon: Truck, title: "Orders to dispatch", body: "Yarn reservation through to the truck leaving the gate." },
  { icon: Landmark, title: "True cost per order", body: "Yarn, wages, power and overheads in every margin." },
];

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        const firstError = Object.values(data.fieldErrors ?? {})[0] as string[] | undefined;
        setError(firstError?.[0] ?? "Login failed");
        return;
      }
      router.push(data.redirectTo ?? "/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel — the mill's control-room navy, with a woven warp/weft texture. */}
      <section className="relative hidden overflow-hidden bg-brand text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 22px), repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 22px)",
          }}
          aria-hidden="true"
        />
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-tint/40 blur-3xl" aria-hidden="true" />

        <div className="relative flex items-center gap-3">
          <BrandMark className="h-10 w-10 ring-1 ring-white/20" />
          <div>
            <p className="font-display text-lg font-semibold leading-6">ThreadLine ERP</p>
            <p className="label-caps-sm text-white/60">Everest Textile Mills · Surat</p>
          </div>
        </div>

        <div className="relative max-w-lg">
          <p className="label-caps text-[#a8b8ff]">Industrial control &amp; loom monitoring</p>
          <h2 className="mt-3 font-display text-4xl font-semibold leading-[1.15] tracking-tight">
            Any order, any roll, any rupee — in seconds.
          </h2>
          <ul className="mt-10 grid grid-cols-2 gap-px bg-white/10">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="bg-brand/95 p-4">
                <Icon className="h-5 w-5 text-[#a8b8ff]" strokeWidth={1.75} aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-xs leading-5 text-white/65">{body}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">Unit 1 · Surat Plant</p>
      </section>

      {/* Sign-in form */}
      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="h-10 w-10" />
            <div>
              <p className="font-display text-lg font-semibold leading-6 text-foreground">ThreadLine ERP</p>
              <p className="label-caps-sm text-gray-500">Everest Textile Mills</p>
            </div>
          </div>

          <div className="rounded-md border border-border/80 bg-white p-6 shadow-md sm:p-8">
            <p className="label-caps text-brand">Mill sign-in</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Welcome back</h1>
            <p className="mt-1 text-[13px] text-gray-500">Sign in with your mill account to open your workspace.</p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <Input
                label="Username"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="username"
                required
              />
              <Input
                label="Password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              {error && (
                <p role="alert" className="border-l-4 border-red-600 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" disabled={loading} className="mt-1 w-full">
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-gray-500">Owner · Floor supervisor · QC inspector · Storekeeper</p>
        </div>
      </section>
    </div>
  );
}
