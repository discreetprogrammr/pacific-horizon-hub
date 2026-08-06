import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Lock, ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LOGO_URL = "/pacific-horizon-tek-logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in | Pacific Horizon Tek Portal" },
      {
        name: "description",
        content:
          "Secure sign-in for the Pacific Horizon Tek internal company resource portal. Authorised staff only.",
      },
      { property: "og:title", content: "Sign in | Pacific Horizon Tek Portal" },
      {
        property: "og:description",
        content:
          "Secure sign-in for the Pacific Horizon Tek internal company resource portal.",
      },

    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError("Invalid credentials. Access is limited to authorised accounts.");
      return;
    }
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="auth-backdrop flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <span className="flex items-center rounded-2xl bg-white px-6 py-4 shadow-xl">
            <img
              src={logo.url}
              alt="Pacific Horizon Tek Inc."
              className="h-14 w-auto object-contain"
            />
          </span>
        </div>

        <div className="glass-card rounded-2xl p-7">
          <h1 className="text-center text-xl font-semibold tracking-tight text-foreground">
            Pacific Horizon Tek
          </h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Internal Resource Portal — authorised personnel only
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                placeholder="name@phtek.com.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Lock className="mr-2 h-4 w-4" />
              )}
              Sign in securely
            </Button>
          </form>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Accounts are provisioned by the administrator. Self sign-up is disabled.
          </p>
        </div>
      </div>
    </div>
  );
}
