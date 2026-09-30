"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Loader2, Save, ShieldCheck, UserRound } from "lucide-react";
import { useMe, useUpdateProfile } from "@/lib/api/account";
import { VerificationPanel } from "@/components/verification-panel";
import { InviteCard } from "@/components/invite-card";
import { NotificationCenter } from "@/components/notification-center";
import { AvailabilityToggle } from "@/components/availability-toggle";
import { LanguagePicker } from "@/lib/i18n";
import { ThemeToggle } from "@/components/theme-toggle";

const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

export default function SettingsPage() {
  const me = useMe();
  const updateProfile = useUpdateProfile();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [contactEmailVisible, setContactEmailVisible] = useState(false);
  const [contactPhoneVisible, setContactPhoneVisible] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    setDisplayName(me.data.displayName || "");
    setPhone(me.data.phone || "");
    setContactEmailVisible(me.data.contactEmailVisible);
    setContactPhoneVisible(me.data.contactPhoneVisible);
  }, [me.data]);

  if (me.isLoading) return <div className="flex h-full items-center justify-center" data-testid="status-settings-loading"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  if (me.error || !me.data) return <p className="m-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-red-300" data-testid="status-settings-error">{me.error?.message || "Account could not be loaded."}</p>;

  function save(event: React.FormEvent) {
    event.preventDefault();
    updateProfile.mutate({
      displayName: displayName.trim(),
      phone: phone.trim(),
      ...(me.data?.role === "provider" ? { contactEmailVisible, contactPhoneVisible } : {}),
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-border bg-background px-5 py-4 md:px-8"><h1 className="text-xl font-semibold">Profile</h1><p className="mt-0.5 text-sm text-muted-foreground">{me.data.email}</p></header>
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
        <AvailabilityToggle />
        <nav className="divide-y divide-border rounded-xl border border-border" aria-label="Profile">
          {[
            ["My bookings", "/requests", true],
            ["My listings & earnings", "/listings", me.data.role === "provider"],
            ["My society", "/society", true],
            ["Plans & payments", "/billing", true],
            ["Shop poster (QR)", "/poster", me.data.role === "provider"],
            ["Admin", "/admin", !!me.data.isAdmin],
            ["Safety & Disclaimer", "/safety", true],
          ].filter(([, , show]) => show).map(([label, href]) => (
            <Link key={href as string} href={href as string} className="flex items-center justify-between px-4 py-3.5 text-sm font-medium hover:bg-foreground/5">
              {label}<span className="text-muted-foreground" aria-hidden="true">›</span>
            </Link>
          ))}
        </nav>
        <div className="flex gap-2"><LanguagePicker className="flex-1" /><ThemeToggle /></div>
        <section className="rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="mb-5 flex items-center gap-3"><UserRound className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Account profile</h2><p className="text-xs text-muted-foreground">{me.data.email}</p></div></div>
          <form className="space-y-4" onSubmit={save}>
            <label className="block text-sm font-medium">Display name<input data-testid="input-profile-display-name" className={`${inputClass} mt-1.5`} value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} required /></label>
            <label className="block text-sm font-medium">Phone number<input data-testid="input-profile-phone" className={`${inputClass} mt-1.5`} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} autoComplete="tel" /></label>
            {me.data.role === "provider" && (
              <fieldset className="space-y-3 rounded-lg border border-border bg-background p-4">
                <legend className="px-1 text-sm font-medium">Contact visibility</legend>
                <p className="text-xs text-muted-foreground">Contact details are only revealed after the marketplace contact gate.</p>
                <label className="flex cursor-pointer items-center justify-between gap-3 text-sm"><span>Show contact email</span><input data-testid="toggle-profile-email-visible" type="checkbox" checked={contactEmailVisible} onChange={(event) => setContactEmailVisible(event.target.checked)} className="h-4 w-4 accent-primary" /></label>
                <label className="flex cursor-pointer items-center justify-between gap-3 text-sm"><span>Show contact phone</span><input data-testid="toggle-profile-phone-visible" type="checkbox" checked={contactPhoneVisible} onChange={(event) => setContactPhoneVisible(event.target.checked)} className="h-4 w-4 accent-primary" /></label>
              </fieldset>
            )}
            <button data-testid="button-save-profile" disabled={updateProfile.isPending || !displayName.trim()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-50" type="submit">{updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{updateProfile.isPending ? "Saving…" : "Save profile"}</button>
            {updateProfile.isSuccess && <p className="text-sm text-primary" data-testid="status-profile-saved">Profile saved.</p>}
            {updateProfile.error && <p className="text-sm text-red-300" role="alert" data-testid="status-profile-error">{updateProfile.error.message}</p>}
          </form>
        </section>

        <InviteCard />

        <div>
          <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 className="font-semibold">Verification</h2></div><Link data-testid="link-full-verification" className="text-sm text-primary hover:underline" href="/verification">Open dedicated page</Link></div>
          <VerificationPanel />
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Bell className="h-5 w-5 text-primary" /><h2 className="font-semibold">Notifications</h2></div><Link data-testid="link-all-notifications" className="text-sm text-primary hover:underline" href="/notifications">Open dedicated page</Link></div>
          <NotificationCenter />
        </div>
      </div>
    </div>
  );
}