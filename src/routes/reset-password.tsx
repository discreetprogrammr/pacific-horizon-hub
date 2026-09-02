import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, KeyRound, ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LOGO_URL = "/pacific-horizon-tek-logo.png";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Set new password | Pacific Horizon Tek Portal" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // The link Supabase emails the user lands here with a recovery token in the
  // URL. supabase-js parses it automatically and fires PASSWORD_RECOVERY once
  // a temporary session is established from it.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    // Fallback in case the event fired before we subscribed, or the link was
    // invalid/expired and no session ever shows up.
    const timer = setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) setReady(true);
        else setLinkInvalid(true);
      });
    }, 2500);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Choose a password that's at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message || "Unable to update password. Please try again.");
      return;
    }

    setDone(true);
    await supabase.auth.signOut();
    setTimeout(() => navigate({ to: "/", replace: true }), 2500);
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
          {linkInvalid ? (
            <>
              <p className="text-center text-sm text-foreground">
                This reset link is invalid or has expired.
              </p>
              <Link
                to="/forgot-password"
                className="mt-5 block text-center text-sm font-medium text-primary hover:underline"
              >
                Request a new link
              </Link>
            </>
          ) : done ? (
            <p className="text-center text-sm text-foreground">
              Password updated. Taking you to the sign-in page...
            </p>
          ) : !ready ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Verifying your reset link...</p>
            </div>
          ) : (
            <>
              <p className="text-center text-sm text-muted-foreground">
                Choose a new password for your account.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
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
                    <KeyRound className="mr-2 h-4 w-4" />
                  )}
                  Update password
                </Button>
              </form>
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
