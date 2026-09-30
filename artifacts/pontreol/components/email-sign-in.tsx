"use client";

import { useEffect, useRef, useState } from "react";
import { LanguagePicker, useT } from "@/lib/i18n";
import { ThemeToggle } from "@/components/theme-toggle";

type Step = "email" | "code";

const MESSAGES: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  invalid_code: "That code isn't right. Check the email and try again.",
  expired_code: "That code has expired. Send a new one.",
  too_many_attempts: "Too many incorrect tries. Send a new code.",
  rate_limited: "Too many requests. Please wait a moment and try again.",
  email_send_failed: "We couldn't send the email right now. Please try again shortly.",
  email_unavailable: "Email sign-in is temporarily unavailable. Please try again later.",
  suspended: "This account is suspended. Contact Pontreol support.",
  account_conflict: "We couldn't sign you in with this email. Please contact Pontreol support.",
  network: "Network problem. Check your connection and try again.",
};

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: any; retryAfter: number }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data, retryAfter: Number(response.headers.get("retry-after")) || 0 };
}

function errorFor(data: any) {
  const code = typeof data?.detail === "string" ? data.detail : "";
  return MESSAGES[code] || "Something went wrong. Please try again.";
}

/** Server-rendered email step; the code step appears after "Continue". */
export function EmailSignIn({ mode, next, referral }: { mode: "sign in" | "sign up"; next?: string; referral?: string }) {
  const t = useT();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setError("");
    setNotice("");
    setPending(true);
    try {
      const result = await post("/api/auth/otp/request", { email });
      if (result.ok) {
        setStep("code");
        setCode("");
        setCooldown(result.data.resendAfter ?? 60);
        setNotice(`We sent a 6-digit code to ${email.trim()}. It expires in ${Math.round((result.data.expiresIn ?? 600) / 60)} minutes.`);
      } else {
        if (result.status === 429 && result.retryAfter) setCooldown(Math.min(result.retryAfter, 3600));
        setError(errorFor(result.data));
      }
    } catch {
      setError(MESSAGES.network);
    } finally {
      setPending(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await post("/api/auth/otp/verify", { email, code, next, ref: referral });
      if (result.ok) {
        // Full navigation: no cached data from any previous account survives.
        window.location.assign(result.data.next || "/home");
        return;
      }
      setError(errorFor(result.data));
      if (["expired_code", "too_many_attempts"].includes(result.data?.detail)) setCode("");
      setPending(false);
    } catch {
      setError(MESSAGES.network);
      setPending(false);
    }
  }

  const heading = mode === "sign up" ? "Create your Pontreol account" : "Sign in to Pontreol";
  const input = "w-full rounded-lg border border-border bg-input px-3 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
  const button = "mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#218075] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2A9D8F] disabled:opacity-60";
  const spinner = <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />;

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center bg-background px-4">
      <div className="absolute top-4 right-4 flex gap-2"><LanguagePicker /><ThemeToggle /></div>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card px-7 py-9 text-foreground shadow-2xl">
        <img src="/logo.svg" alt="Pontreol" className="mx-auto mb-6 h-10 max-w-40" />
        <h1 className="text-center text-xl font-semibold">{heading}</h1>
        {referral && <p className="mt-2 text-center text-xs text-primary">You were invited to Pontreol 🎉</p>}

        {step === "email" ? (
          <form onSubmit={sendCode} className="mt-6 text-left" noValidate>
            <label htmlFor="email" className="mb-1.5 block text-sm text-muted-foreground">{t("emailAddress")}</label>
            <input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
              spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" className={input} data-testid="input-email" />
            <button type="submit" disabled={pending || !email.trim() || cooldown > 0} className={button} data-testid="button-send-code">
              {pending && spinner}
              {cooldown > 0 ? `Try again in ${cooldown}s` : "Continue"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-6 text-left">
            {notice && <p className="mb-4 text-sm text-muted-foreground" role="status">{notice}</p>}
            <label htmlFor="code" className="mb-1.5 block text-sm text-muted-foreground">{t("verificationCode")}</label>
            <input ref={codeInput} id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code"
              pattern="[0-9]*" maxLength={6} required value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456" className={`${input} text-center text-2xl tracking-[0.5em]`} data-testid="input-code" />
            <button type="submit" disabled={pending || code.length !== 6} className={button} data-testid="button-verify">
              {pending && spinner}
              Verify
            </button>
            <div className="mt-4 flex items-center justify-between text-sm">
              <button type="button" onClick={() => { setStep("email"); setError(""); setNotice(""); setCode(""); }}
                className="text-muted-foreground hover:text-foreground" data-testid="button-change-email">Change email</button>
              <button type="button" onClick={() => void sendCode()} disabled={pending || cooldown > 0}
                className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline" data-testid="button-resend">
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-300" data-testid="status-auth-error">{error}</p>
        )}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          {mode === "sign up"
            ? <>Already have an account? <a href="/sign-in" className="text-primary hover:underline">Sign in</a></>
            : <>New to Pontreol? Verifying your email creates your account.</>}
        </p>
      </div>
    </div>
  );
}
