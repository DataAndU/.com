"use client";

import { useState } from "react";
import { FileSearch, Loader2, Search, ShieldAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";
import { useMe } from "@/lib/api/account";
import {
  useAdminAudit,
  useAdminListings,
  useAdminModerateListing,
  useAdminSuspendUser,
  useAdminUsers,
  useAdminVerificationDecision,
  useAdminVerifications,
} from "@/lib/api/admin";
import { BillingAdminPanel } from "./billing-admin-panel";

type Tab = "verifications" | "users" | "listings" | "audit" | "billing" | "referrals";
const tabs: Tab[] = ["verifications", "users", "listings", "audit", "billing", "referrals"];
const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

export function AdminConsole() {
  const me = useMe();
  if (me.isLoading) return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (me.error) return <p className="p-5 text-sm text-red-300" data-testid="status-admin-account-error">{me.error.message}</p>;
  if (!me.data?.isAdmin) return <div className="rounded-xl border border-border bg-card p-8 text-center" data-testid="status-admin-required"><ShieldAlert className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><p>Administrator access required.</p></div>;
  return <AuthorizedAdminConsole />;
}

function AuthorizedAdminConsole() {
  const [tab, setTab] = useState<Tab>("verifications");
  return (
    <section className="space-y-6" data-testid="panel-admin-console">
      <header>
        <h1 className="text-2xl font-bold">Admin console</h1>
        <div className="mt-4 flex gap-2 overflow-x-auto">
          {tabs.map((item) => <button key={item} type="button" data-testid={`button-admin-${item}`} onClick={() => setTab(item)} className={`rounded-lg px-4 py-2 text-sm font-medium capitalize ${tab === item ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}>{item}</button>)}
        </div>
      </header>
      {tab === "verifications" && <VerificationQueue />}
      {tab === "users" && <UserModeration />}
      {tab === "listings" && <ListingModeration />}
      {tab === "audit" && <AuditLog />}
      {tab === "billing" && <BillingAdminPanel />}
      {tab === "referrals" && <ReferralReport />}
    </section>
  );
}

function VerificationQueue() {
  const [status, setStatus] = useState("pending");
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const query = useAdminVerifications(status, cursor, 25);
  const decision = useAdminVerificationDecision();
  return (
    <Panel title="Identity reviews" loading={query.isLoading} error={query.error}>
      <select data-testid="select-verification-status" className={`${inputClass} mb-4 max-w-xs`} value={status} onChange={(event) => { setStatus(event.target.value); setCursor(undefined); setCursorHistory([]); }}><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option></select>
      <div className="space-y-4">
        {query.data?.items.map((item) => (
          <article key={item.id} className="rounded-xl border border-border bg-card p-4" data-testid={`card-admin-verification-${item.id}`}>
            <div className="grid gap-4 md:grid-cols-[1fr_220px]">
              <div>
                <p className="font-semibold">{item.legalName}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.idType} · submitted {new Date(item.submittedAt).toLocaleString()}</p>
                <p className="mt-1 text-xs text-muted-foreground">User {item.userId}</p>
                {item.rejectionReason && <p className="mt-2 text-sm text-red-300">{item.rejectionReason}</p>}
              </div>
              <a href={`/api/media/${item.idMediaId}`} target="_blank" rel="noreferrer" data-testid={`link-private-id-${item.id}`} className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-3 text-sm hover:border-primary"><FileSearch className="h-4 w-4" />Open private ID</a>
            </div>
            {item.status === "pending" && <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <input data-testid={`input-verification-reason-${item.id}`} className={inputClass} placeholder="Reason (required for rejection)" value={reasons[item.id] || ""} onChange={(event) => setReasons({ ...reasons, [item.id]: event.target.value })} maxLength={2000} />
              <button data-testid={`button-approve-verification-${item.id}`} disabled={decision.isPending} onClick={() => decision.mutate({ id: item.id, decision: "verified", reason: reasons[item.id] || undefined })} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">Approve</button>
              <button data-testid={`button-reject-verification-${item.id}`} disabled={decision.isPending || !reasons[item.id]?.trim()} onClick={() => decision.mutate({ id: item.id, decision: "rejected", reason: reasons[item.id].trim() })} className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold disabled:opacity-50">Reject</button>
            </div>}
          </article>
        ))}
        {!query.data?.items.length && !query.isLoading && <Empty text="No verification submissions match this status." />}
        {decision.error && <ErrorText error={decision.error} />}
      </div>
      <CursorNav cursor={cursor} history={cursorHistory} nextCursor={query.data?.nextCursor} loading={query.isFetching} testId="verifications" onChange={(next, history) => { setCursor(next); setCursorHistory(history); }} />
    </Panel>
  );
}

function UserModeration() {
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const query = useAdminUsers(search || undefined, undefined, cursor, 25);
  const suspend = useAdminSuspendUser();
  return (
    <Panel title="User accounts" loading={query.isLoading} error={query.error}>
      <form className="mb-4 flex max-w-lg gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(draftSearch.trim()); setCursor(undefined); setCursorHistory([]); }}>
        <input data-testid="input-admin-user-search" className={inputClass} type="search" placeholder="Search by email" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} />
        <button data-testid="button-admin-user-search" className="rounded-lg bg-primary px-3" type="submit"><Search className="h-4 w-4" /></button>
      </form>
      <div className="space-y-3">
        {query.data?.items.map((user) => <article key={user.id} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[1fr_1fr_auto]" data-testid={`card-admin-user-${user.id}`}>
          <div><p className="font-medium">{user.displayName}</p><p className="text-sm text-muted-foreground">{user.email} · {user.role || "No role"}</p></div>
          <input data-testid={`input-suspend-reason-${user.id}`} className={inputClass} placeholder="Suspension reason" maxLength={2000} value={reasons[user.id] || ""} onChange={(event) => setReasons({ ...reasons, [user.id]: event.target.value })} />
          <button data-testid={`button-suspend-user-${user.id}`} disabled={suspend.isPending || user.isAdmin || !reasons[user.id]?.trim()} onClick={() => suspend.mutate({ id: user.id, suspended: true, reason: reasons[user.id].trim() })} className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold disabled:opacity-50">{user.isAdmin ? "Administrator" : "Suspend"}</button>
        </article>)}
        {!query.data?.items.length && !query.isLoading && <Empty text="No users found." />}
        {suspend.error && <ErrorText error={suspend.error} />}
      </div>
      <CursorNav cursor={cursor} history={cursorHistory} nextCursor={query.data?.nextCursor} loading={query.isFetching} testId="users" onChange={(next, history) => { setCursor(next); setCursorHistory(history); }} />
    </Panel>
  );
}

function ListingModeration() {
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const query = useAdminListings(status || undefined, cursor, 25);
  const moderate = useAdminModerateListing();
  return (
    <Panel title="Listing moderation" loading={query.isLoading} error={query.error}>
      <select data-testid="select-admin-listing-status" className={`${inputClass} mb-4 max-w-xs`} value={status} onChange={(event) => { setStatus(event.target.value); setCursor(undefined); setCursorHistory([]); }}><option value="">All statuses</option><option value="active">Active</option><option value="paused">Paused</option></select>
      <div className="space-y-3">
        {query.data?.items.map((listing) => <article key={listing.id} className="rounded-xl border border-border bg-card p-4" data-testid={`card-admin-listing-${listing.id}`}>
          <div className="flex justify-between gap-3"><div><p className="font-medium">{listing.title}</p><p className="text-sm text-muted-foreground">{listing.category} · {listing.status} · {listing.locationLabel}</p></div><span className="text-sm">₹{listing.price}</span></div>
          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <input data-testid={`input-listing-reason-${listing.id}`} className={inputClass} placeholder="Moderation reason" maxLength={2000} value={reasons[listing.id] || ""} onChange={(event) => setReasons({ ...reasons, [listing.id]: event.target.value })} />
            <button data-testid={`button-toggle-listing-${listing.id}`} disabled={moderate.isPending || !reasons[listing.id]?.trim()} onClick={() => moderate.mutate({ id: listing.id, action: listing.status === "active" ? "pause" : "restore", reason: reasons[listing.id].trim() })} className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold disabled:opacity-50">{listing.status === "active" ? "Pause" : "Restore"}</button>
            <button data-testid={`button-delete-listing-${listing.id}`} disabled={moderate.isPending || !reasons[listing.id]?.trim()} onClick={() => { if (window.confirm(`Permanently delete “${listing.title}”?`)) moderate.mutate({ id: listing.id, action: "delete", reason: reasons[listing.id].trim() }); }} className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold disabled:opacity-50">Delete</button>
          </div>
        </article>)}
        {!query.data?.items.length && !query.isLoading && <Empty text="No listings match this status." />}
        {moderate.error && <ErrorText error={moderate.error} />}
      </div>
      <CursorNav cursor={cursor} history={cursorHistory} nextCursor={query.data?.nextCursor} loading={query.isFetching} testId="listings" onChange={(next, history) => { setCursor(next); setCursorHistory(history); }} />
    </Panel>
  );
}

function AuditLog() {
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const query = useAdminAudit(cursor, 25);
  return <Panel title="Audit trail" loading={query.isLoading} error={query.error}><div className="space-y-2">{query.data?.items.map((record) => <article key={record.id} className="rounded-lg border border-border bg-card p-4" data-testid={`row-audit-${record.id}`}><div className="flex flex-wrap justify-between gap-2"><p className="font-mono text-sm text-primary">{record.action}</p><time className="text-xs text-muted-foreground">{new Date(record.createdAt).toLocaleString()}</time></div><p className="mt-1 text-sm text-muted-foreground">{record.targetType} · {record.targetId}</p><pre className="mt-2 overflow-x-auto text-xs text-muted-foreground">{JSON.stringify(record.metadata, null, 2)}</pre></article>)}{!query.data?.items.length && !query.isLoading && <Empty text="No audit records." />}</div><CursorNav cursor={cursor} history={cursorHistory} nextCursor={query.data?.nextCursor} loading={query.isFetching} testId="audit" onChange={(next, history) => { setCursor(next); setCursorHistory(history); }} /></Panel>;
}

function ReferralReport() {
  const query = useQuery<{ items: { id: string; email: string; displayName: string; creditMonths: number }[] }>({
    queryKey: ["admin-referrals"], queryFn: () => fetchApi("/admin/referrals"),
  });
  return (
    <Panel title="Referral credits" loading={query.isLoading} error={query.error}>
      <p className="mb-4 text-sm text-muted-foreground">Free months earned by inviting providers. Apply them to the person's plan (for example with a discount code in Billing).</p>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {query.data?.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between p-4 text-sm">
            <span><span className="font-medium">{item.displayName}</span> <span className="text-muted-foreground">{item.email}</span></span>
            <span className="font-semibold text-primary">{item.creditMonths} free {item.creditMonths === 1 ? "month" : "months"}</span>
          </div>
        ))}
        {query.data && query.data.items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No referral credits yet.</p>}
      </div>
    </Panel>
  );
}

function Panel({ title, loading, error, children }: { title: string; loading: boolean; error: Error | null; children: React.ReactNode }) {
  return <section><h2 className="mb-4 text-lg font-semibold">{title}</h2>{loading ? <div className="p-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></div> : error ? <ErrorText error={error} /> : children}</section>;
}
function ErrorText({ error }: { error: Error }) { return <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-red-300" role="alert">{error.message}</p>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{text}</p>; }
function CursorNav({ cursor, history, nextCursor, loading, testId, onChange }: { cursor?: string; history: string[]; nextCursor?: string | null; loading: boolean; testId: string; onChange: (cursor: string | undefined, history: string[]) => void }) {
  if (!cursor && !nextCursor && history.length === 0) return null;
  return <nav className="mt-5 flex items-center justify-between" aria-label="Pagination">
    <button type="button" data-testid={`button-previous-${testId}`} disabled={loading || history.length === 0} onClick={() => { const prior = history[history.length - 1]; onChange(prior || undefined, history.slice(0, -1)); }} className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">Previous</button>
    <span className="text-xs text-muted-foreground">Cursor page {history.length + 1}</span>
    <button type="button" data-testid={`button-next-${testId}`} disabled={loading || !nextCursor} onClick={() => nextCursor && onChange(nextCursor, [...history, cursor || ""])} className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">Next</button>
  </nav>;
}