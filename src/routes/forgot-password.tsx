import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Mail, ArrowLeft, ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LOGO_URL = "/pacific-horizon-tek-logo.png";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset password | Pacific Horizon Tek Portal" },
      {
        name: "description",
        content: "Request a password reset link for the Pacific Horizon Tek internal portal.",
      },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    if (resetError?.status === 429) {
      setError("Too many attempts. Please wait a few minutes and try again.");
      return;
    }

    // Whatever the outcome (including "no account with that email"), show the
    // same confirmation so we never reveal which work emails are registered.
    setSent(true);
  }

  return (
    <div className="auth-backdrop flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <span className="flex items-center rounded-2xl bg-white px-6 py-4 shadow-xl">
            <img
              src={LOGO_URL}
              alt="Pacific Horizon Tek Inc."
              className="h-14 w-auto object-contain"
            />
          </span>
        </div>

        <div className="glass-card rounded-2xl p-7">
          {sent ? (
            <>
              <p className="text-center text-sm text-foreground">
                If <span className="font-medium">{email.trim()}</span> is a registered portal
                account, we've sent a password reset link to it.
              </p>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Check your inbox (and spam folder). The link expires after a while, so use it soon.
              </p>
              <Link
                to="/"
                className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <p className="text-center text-sm text-muted-foreground">
                Enter your work email and we'll send you a link to reset your password.
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

                {error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="mr-2 h-4 w-4" />
                  )}
                  Send reset link
                </Button>
              </form>

              <Link
                to="/"
                className="mt-5 flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </Link>
            </>
          )}

          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Accounts are provisioned by the administrator. Self sign-up is disabled.
          </p>
        </div>
      </div>
    </div>
  );
}
