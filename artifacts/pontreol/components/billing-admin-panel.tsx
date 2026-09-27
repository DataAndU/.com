"use client";

import { useEffect, useState } from "react";
import { CreditCard, IndianRupee, Loader2, Pencil, Plus, Save, Users, X } from "lucide-react";
import type { Discount, Plan } from "@/lib/api/client";
import {
  useAdminCreateDiscount,
  useAdminCreatePlan,
  useAdminDiscounts,
  useAdminPlans,
  useAdminRevenue,
  useAdminSettings,
  useAdminUpdateDiscount,
  useAdminUpdatePlan,
  useAdminUpdateSettings,
} from "@/lib/api/billing";

type PlanDraft = {
  name: string;
  role: "buyer" | "provider";
  cycle: "monthly" | "yearly";
  amountPaise: string;
  active: boolean;
};

type DiscountDraft = {
  code: string;
  kind: "percentage" | "flat";
  value: string;
  planIds: string[];
  startsAt: string;
  endsAt: string;
  maxUses: string;
  active: boolean;
};

const emptyPlan: PlanDraft = { name: "", role: "buyer", cycle: "monthly", amountPaise: "", active: true };
const emptyDiscount: DiscountDraft = { code: "", kind: "percentage", value: "", planIds: [], startsAt: "", endsAt: "", maxUses: "", active: true };
const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function toLocal(iso: string) {
  const date = new Date(iso);
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

export function BillingAdminPanel() {
  const plans = useAdminPlans();
  const discounts = useAdminDiscounts();
  const settings = useAdminSettings();
  const revenue = useAdminRevenue();
  const createPlan = useAdminCreatePlan();
  const updatePlan = useAdminUpdatePlan();
  const createDiscount = useAdminCreateDiscount();
  const updateDiscount = useAdminUpdateDiscount();
  const updateSettings = useAdminUpdateSettings();
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [discountDraft, setDiscountDraft] = useState<DiscountDraft | null>(null);
  const [editingDiscountId, setEditingDiscountId] = useState<string | null>(null);
  const [freeLimit, setFreeLimit] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) setFreeLimit(String(settings.data.freeContactLimit));
  }, [settings.data]);

  function editPlan(plan: Plan) {
    setEditingPlanId(plan.id);
    setPlanDraft({ name: plan.name, role: plan.role, cycle: plan.cycle, amountPaise: String(plan.amountPaise), active: plan.active });
    setFormError(null);
  }

  function editDiscount(discount: Discount) {
    setEditingDiscountId(discount.id);
    setDiscountDraft({
      code: discount.code,
      kind: discount.kind,
      value: String(discount.value),
      planIds: discount.planIds,
      startsAt: toLocal(discount.startsAt),
      endsAt: toLocal(discount.endsAt),
      maxUses: String(discount.maxUses),
      active: discount.active,
    });
    setFormError(null);
  }

  function submitPlan(event: React.FormEvent) {
    event.preventDefault();
    if (!planDraft) return;
    const amountPaise = Number(planDraft.amountPaise);
    if (!planDraft.name.trim() || !Number.isInteger(amountPaise) || amountPaise < 100) {
      setFormError("Enter a plan name and an integer price of at least 100 paise.");
      return;
    }
    const data = { ...planDraft, name: planDraft.name.trim(), amountPaise, currency: "INR" as const };
    const mutation = editingPlanId ? updatePlan : createPlan;
    const variables = editingPlanId ? { id: editingPlanId, data } : data;
    mutation.mutate(variables as never, {
      onSuccess: () => {
        setPlanDraft(null);
        setEditingPlanId(null);
        setFormError(null);
      },
    });
  }

  function submitDiscount(event: React.FormEvent) {
    event.preventDefault();
    if (!discountDraft) return;
    const value = Number(discountDraft.value);
    const maxUses = Number(discountDraft.maxUses);
    const startsAt = new Date(discountDraft.startsAt);
    const endsAt = new Date(discountDraft.endsAt);
    if (!discountDraft.code.trim() || !Number.isInteger(value) || value < 1 || (discountDraft.kind === "percentage" && value > 100) || !Number.isInteger(maxUses) || maxUses < 1 || !discountDraft.planIds.length || Number.isNaN(startsAt.valueOf()) || endsAt <= startsAt) {
      setFormError("Complete every discount field. Select a plan and use a valid date range.");
      return;
    }
    const data = {
      ...discountDraft,
      code: discountDraft.code.trim().toUpperCase(),
      value,
      maxUses,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
    const mutation = editingDiscountId ? updateDiscount : createDiscount;
    const variables = editingDiscountId ? { id: editingDiscountId, data } : data;
    mutation.mutate(variables as never, {
      onSuccess: () => {
        setDiscountDraft(null);
        setEditingDiscountId(null);
        setFormError(null);
      },
    });
  }

  if (plans.isLoading || discounts.isLoading || settings.isLoading || revenue.isLoading) {
    return <div className="flex min-h-48 items-center justify-center" data-testid="status-billing-admin-loading"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  const queryError = plans.error || discounts.error || settings.error || revenue.error;
  if (queryError) {
    return <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-red-300" data-testid="status-billing-admin-error">{queryError.message}</p>;
  }

  const mutationError = createPlan.error || updatePlan.error || createDiscount.error || updateDiscount.error;
  const busy = createPlan.isPending || updatePlan.isPending || createDiscount.isPending || updateDiscount.isPending;

  return (
    <div className="space-y-8" data-testid="panel-billing-admin">
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Revenue & subscriptions</h2><p className="text-sm text-muted-foreground">Captured {revenue.data?.testMode === false ? "live" : "test-mode"} billing records only.</p></div>
          <span className={`rounded-full px-3 py-1 text-xs ${revenue.data?.testMode === false ? "bg-red-400/10 text-red-200" : "bg-amber-400/10 text-amber-200"}`}>{revenue.data?.testMode === false ? "Live mode" : "Test mode"}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Summary icon={<IndianRupee className="h-5 w-5" />} label="Captured revenue" value={`₹${((revenue.data?.totalCapturedPaise || 0) / 100).toFixed(2)}`} />
          <Summary icon={<Users className="h-5 w-5" />} label="Active subscriptions" value={String(revenue.data?.subscriptions.filter((item) => item.status === "active").length || 0)} />
          <Summary icon={<CreditCard className="h-5 w-5" />} label="Captured payments" value={String(revenue.data?.payments.filter((item) => item.status === "captured").length || 0)} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Period end</th></tr></thead>
            <tbody className="divide-y divide-border">
              {revenue.data?.subscriptions.map((subscription) => <tr key={subscription.id} data-testid={`row-admin-subscription-${subscription.id}`}><td className="px-4 py-3">{subscription.planName}</td><td className="px-4 py-3 capitalize">{subscription.status}</td><td className="px-4 py-3">₹{(subscription.amountPaise / 100).toFixed(2)} / {subscription.cycle}</td><td className="px-4 py-3 text-muted-foreground">{subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : "—"}</td></tr>)}
            {!revenue.data?.subscriptions.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No subscriptions recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold">Free buyer allowance</h2>
        <p className="mt-1 text-sm text-muted-foreground">Monthly qualified provider contacts available before payment.</p>
        <form className="mt-4 flex max-w-sm items-end gap-3" onSubmit={(event) => {
          event.preventDefault();
          const value = Number(freeLimit);
          if (!Number.isInteger(value) || value < 0 || value > 100000) {
            setFormError("Free contact limit must be an integer from 0 to 100000.");
            return;
          }
          updateSettings.mutate({ freeContactLimit: value });
        }}>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="free-limit">Contacts per month</label>
            <input id="free-limit" data-testid="input-free-contact-limit" className={inputClass} type="number" min={0} max={100000} step={1} value={freeLimit} onChange={(event) => setFreeLimit(event.target.value)} />
          </div>
          <button data-testid="button-save-free-limit" disabled={updateSettings.isPending} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold disabled:opacity-50" type="submit"><Save className="h-4 w-4" />Save</button>
        </form>
        {updateSettings.error && <p className="mt-3 text-sm text-red-300">{updateSettings.error.message}</p>}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Paid plans</h2>
          <button data-testid="button-new-plan" type="button" onClick={() => { setEditingPlanId(null); setPlanDraft({ ...emptyPlan }); setFormError(null); }} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold"><Plus className="h-4 w-4" />New plan</button>
        </div>
        {planDraft && (
          <form className="mb-5 grid gap-3 rounded-xl border border-primary/30 bg-card p-5 md:grid-cols-2" onSubmit={submitPlan} data-testid="form-plan">
            <label className="text-sm">Name<input data-testid="input-plan-name" className={`${inputClass} mt-1`} value={planDraft.name} maxLength={100} onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })} required /></label>
            <label className="text-sm">Price in paise<input data-testid="input-plan-price" className={`${inputClass} mt-1`} type="number" min={100} step={1} value={planDraft.amountPaise} onChange={(event) => setPlanDraft({ ...planDraft, amountPaise: event.target.value })} required /></label>
            <label className="text-sm">Role<select data-testid="select-plan-role" className={`${inputClass} mt-1`} value={planDraft.role} onChange={(event) => setPlanDraft({ ...planDraft, role: event.target.value as PlanDraft["role"] })}><option value="buyer">Buyer</option><option value="provider">Provider</option></select></label>
            <label className="text-sm">Billing cycle<select data-testid="select-plan-cycle" className={`${inputClass} mt-1`} value={planDraft.cycle} onChange={(event) => setPlanDraft({ ...planDraft, cycle: event.target.value as PlanDraft["cycle"] })}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
            <label className="flex items-center gap-2 text-sm"><input data-testid="toggle-plan-active" type="checkbox" checked={planDraft.active} onChange={(event) => setPlanDraft({ ...planDraft, active: event.target.checked })} className="accent-primary" />Active</label>
            <div className="flex justify-end gap-2">
              <button data-testid="button-cancel-plan" type="button" onClick={() => setPlanDraft(null)} className="rounded-lg border border-border px-3 py-2 text-sm"><X className="h-4 w-4" /></button>
              <button data-testid="button-save-plan" disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold disabled:opacity-50" type="submit">{editingPlanId ? "Update plan" : "Create plan"}</button>
            </div>
          </form>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {plans.data?.plans.map((plan) => (
            <article key={plan.id} className="rounded-xl border border-border bg-card p-4" data-testid={`card-plan-${plan.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-xs uppercase text-primary">{plan.role} · {plan.cycle}</p><h3 className="mt-1 font-semibold">{plan.name}</h3><p className="mt-2 text-xl">₹{(plan.amountPaise / 100).toFixed(2)}</p></div>
                <button data-testid={`button-edit-plan-${plan.id}`} type="button" onClick={() => editPlan(plan)} className="rounded-lg border border-border p-2 hover:text-primary"><Pencil className="h-4 w-4" /></button>
              </div>
              <p className={`mt-3 text-xs ${plan.active ? "text-primary" : "text-muted-foreground"}`}>{plan.active ? "Active" : "Inactive"}</p>
            </article>
          ))}
          {!plans.data?.plans.length && <p className="text-sm text-muted-foreground">No paid plans configured.</p>}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Discounts</h2>
          <button data-testid="button-new-discount" type="button" onClick={() => { setEditingDiscountId(null); setDiscountDraft({ ...emptyDiscount }); setFormError(null); }} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold"><Plus className="h-4 w-4" />New discount</button>
        </div>
        {discountDraft && (
          <form className="mb-5 grid gap-3 rounded-xl border border-primary/30 bg-card p-5 md:grid-cols-2" onSubmit={submitDiscount} data-testid="form-discount">
            <label className="text-sm">Code<input data-testid="input-discount-code" className={`${inputClass} mt-1 uppercase`} value={discountDraft.code} maxLength={50} onChange={(event) => setDiscountDraft({ ...discountDraft, code: event.target.value })} required /></label>
            <label className="text-sm">Kind<select data-testid="select-discount-kind" className={`${inputClass} mt-1`} value={discountDraft.kind} onChange={(event) => setDiscountDraft({ ...discountDraft, kind: event.target.value as DiscountDraft["kind"] })}><option value="percentage">Percentage</option><option value="flat">Flat paise</option></select></label>
            <label className="text-sm">Value<input data-testid="input-discount-value" className={`${inputClass} mt-1`} type="number" min={1} step={1} value={discountDraft.value} onChange={(event) => setDiscountDraft({ ...discountDraft, value: event.target.value })} required /></label>
            <label className="text-sm">Maximum uses<input data-testid="input-discount-max-uses" className={`${inputClass} mt-1`} type="number" min={1} step={1} value={discountDraft.maxUses} onChange={(event) => setDiscountDraft({ ...discountDraft, maxUses: event.target.value })} required /></label>
            <label className="text-sm">Starts at<input data-testid="input-discount-start" className={`${inputClass} mt-1`} type="datetime-local" value={discountDraft.startsAt} onChange={(event) => setDiscountDraft({ ...discountDraft, startsAt: event.target.value })} required /></label>
            <label className="text-sm">Ends at<input data-testid="input-discount-end" className={`${inputClass} mt-1`} type="datetime-local" value={discountDraft.endsAt} onChange={(event) => setDiscountDraft({ ...discountDraft, endsAt: event.target.value })} required /></label>
            <fieldset className="md:col-span-2">
              <legend className="mb-2 text-sm">Applicable plans</legend>
              <div className="flex flex-wrap gap-3">
                {plans.data?.plans.map((plan) => <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm" key={plan.id}><input data-testid={`toggle-discount-plan-${plan.id}`} type="checkbox" checked={discountDraft.planIds.includes(plan.id)} onChange={(event) => setDiscountDraft({ ...discountDraft, planIds: event.target.checked ? [...discountDraft.planIds, plan.id] : discountDraft.planIds.filter((id) => id !== plan.id) })} className="accent-primary" />{plan.name}</label>)}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input data-testid="toggle-discount-active" type="checkbox" checked={discountDraft.active} onChange={(event) => setDiscountDraft({ ...discountDraft, active: event.target.checked })} className="accent-primary" />Active</label>
            <div className="flex justify-end gap-2">
              <button data-testid="button-cancel-discount" type="button" onClick={() => setDiscountDraft(null)} className="rounded-lg border border-border px-3 py-2"><X className="h-4 w-4" /></button>
              <button data-testid="button-save-discount" disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold disabled:opacity-50" type="submit">{editingDiscountId ? "Update discount" : "Create discount"}</button>
            </div>
          </form>
        )}
        <div className="space-y-3">
          {discounts.data?.discounts.map((discount) => (
            <article key={discount.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4" data-testid={`card-discount-${discount.id}`}>
              <div><h3 className="font-mono font-semibold">{discount.code}</h3><p className="mt-1 text-sm text-muted-foreground">{discount.kind === "percentage" ? `${discount.value}%` : `₹${(discount.value / 100).toFixed(2)}`} · {discount.uses}/{discount.maxUses} used · {discount.active ? "Active" : "Inactive"}</p></div>
              <button data-testid={`button-edit-discount-${discount.id}`} type="button" onClick={() => editDiscount(discount)} className="rounded-lg border border-border p-2 hover:text-primary"><Pencil className="h-4 w-4" /></button>
            </article>
          ))}
          {!discounts.data?.discounts.length && <p className="text-sm text-muted-foreground">No discounts configured.</p>}
        </div>
      </section>
      {(formError || mutationError) && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-red-300" data-testid="status-billing-form-error">{formError || mutationError?.message}</p>}
    </div>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2 text-primary">{icon}<span className="text-xs uppercase text-muted-foreground">{label}</span></div><p className="mt-3 text-2xl font-semibold">{value}</p></div>;
}