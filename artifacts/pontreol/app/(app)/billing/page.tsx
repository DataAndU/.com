"use client";

import { useBillingStatus, usePlans, useCancelSubscription, useSubscribe, usePayments, useVerifySubscription, useChangePlan } from "@/lib/api/billing";
import { format } from "date-fns";
import { CreditCard, AlertCircle, CheckCircle2, ShieldAlert, ArrowRightCircle } from "lucide-react";
import { useState } from "react";
import Script from "next/script";

declare global {
  interface Window {
    Razorpay: any;
  }
}

export default function BillingPage() {
  const { data: statusData, isLoading: statusLoading } = useBillingStatus();
  const { data: plansData, isLoading: plansLoading } = usePlans();
  const { data: paymentsData } = usePayments();
  
  const cancelMutation = useCancelSubscription();
  const subscribeMutation = useSubscribe();
  const verifyMutation = useVerifySubscription();
  const changePlanMutation = useChangePlan();

  const [discountCode, setDiscountCode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  if (statusLoading || plansLoading) {
    return <div className="p-8 flex items-center justify-center min-h-[50vh]"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  }

  const handleSubscribe = (planId: string) => {
    setErrorMsg("");
    
    // Change plan if an active subscription exists
    if (statusData?.subscription && statusData.subscription.status === 'active' && !statusData.subscription.cancelAtPeriodEnd) {
      if (statusData.testMode === false && !window.confirm(
        "LIVE BILLING: This changes the plan used for your next real recurring charge. Continue?"
      )) return;
      changePlanMutation.mutate({ subscriptionId: statusData.subscription.id, planId }, {
        onError: (err) => {
          setErrorMsg(err.message);
        }
      });
      return;
    }

    // New subscription flow
    if (plansData?.testMode === false) {
      const confirmed = window.confirm(
        "LIVE PAYMENT: Razorpay will charge real money now and future renewals will also be real charges. Continue to live checkout?"
      );
      if (!confirmed) return;
    }
    subscribeMutation.mutate({ planId, discountCode: discountCode || undefined }, {
      onSuccess: (data) => {
        if (!window.Razorpay) {
          setErrorMsg("Razorpay failed to load. Please check your connection.");
          return;
        }

        const options = {
          key: data.checkout.keyId,
          subscription_id: data.checkout.subscriptionId,
          name: data.checkout.name,
          description: data.checkout.description,
          handler: function (response: any) {
            verifyMutation.mutate({
              subscriptionId: data.subscription.id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }, {
              onError: (err) => setErrorMsg("Verification failed: " + err.message)
            });
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function (response: any){
          setErrorMsg("Payment failed: " + response.error.description);
        });
        rzp.open();
      },
      onError: (err) => {
        setErrorMsg(err.message);
      }
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      
      <div className="max-w-4xl mx-auto space-y-8">
        
        <div>
          <h1 className="text-2xl font-bold mb-2">Billing & Plans</h1>
          <p className="text-muted-foreground">Manage your subscription and billing history.</p>
          <p className="mt-2 text-xs text-muted-foreground">Plans are paid to Pontreol through Razorpay. Payments for bookings are arranged directly with the provider. <a href="/safety" className="underline">Safety &amp; Disclaimer</a></p>
        </div>

        {plansData && !plansData.checkoutAvailable && !statusData?.subscription && (
          <div className="mb-6 p-4 rounded-lg border border-amber-500/40 bg-amber-500/10 text-sm">
            Subscribing is switched off: {(plansData as { checkoutProblem?: string }).checkoutProblem ?? "Razorpay is not configured."}
          </div>
        )}
        {errorMsg && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl flex items-center gap-3 animate-fade-in">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">{errorMsg}</span>
          </div>
        )}

        {(statusData?.testMode || plansData?.testMode) && (
          <div className="bg-primary/10 border border-primary/20 text-primary px-4 py-3 rounded-xl flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">Test Mode Active. No real charges will be made. Using sandbox credentials.</span>
          </div>
        )}

        {statusData?.testMode === false && plansData?.testMode === false && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-xl flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">Live billing is active. Subscribing opens Razorpay for a real recurring charge; test payments are not shown or counted here.</span>
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Current Status</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                {statusData?.paid ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Paid Access
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    Free Tier
                  </span>
                )}
              </div>
              
              {!statusData?.paid && (
                <div>
                  <span className="text-muted-foreground block mb-1 text-sm">Free Contacts Remaining:</span>
                  <span className="text-xl font-medium">{statusData?.freeContactLimit ?? 0}</span>
                </div>
              )}
            </div>

            {statusData?.subscription && (
              <div className="space-y-4 bg-background border border-border rounded-lg p-4 relative overflow-hidden">
                {verifyMutation.isPending && (
                  <div className="absolute inset-0 bg-background/50 flex items-center justify-center backdrop-blur-sm z-10">
                    <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                )}
                
                <div>
                  <div className="text-sm text-muted-foreground">Active Plan</div>
                  <div className="font-medium text-lg">{statusData.subscription.planName}</div>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium">₹{(statusData.subscription.amountPaise / 100).toFixed(2)}</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Cycle</span>
                  <span className="font-medium capitalize">{statusData.subscription.cycle}</span>
                </div>

                {statusData.subscription.currentPeriodEnd && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Renews On</span>
                    <span className="font-medium">{format(new Date(statusData.subscription.currentPeriodEnd), "MMM d, yyyy")}</span>
                  </div>
                )}
                
                {statusData.subscription.scheduledChange && (
                  <div className="bg-primary/10 text-primary text-xs px-3 py-2 rounded-md flex items-center gap-2 mt-4">
                    <ArrowRightCircle className="w-4 h-4 shrink-0" />
                    Changes to {statusData.subscription.scheduledChange.planName} on renewal
                  </div>
                )}

                {statusData.subscription.cancelAtPeriodEnd ? (
                  <div className="bg-destructive/10 text-destructive text-xs px-3 py-2 rounded-md flex items-center gap-2 mt-4">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    Cancels at end of billing period
                  </div>
                ) : (
                  <button 
                    onClick={() => {
                      if (confirm("Are you sure you want to cancel your subscription?")) {
                        cancelMutation.mutate({ subscriptionId: statusData.subscription!.id }, {
                          onError: (err) => setErrorMsg(err.message)
                        });
                      }
                    }}
                    disabled={cancelMutation.isPending || changePlanMutation.isPending || !!statusData.subscription.scheduledChange}
                    className="w-full mt-4 py-2 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {cancelMutation.isPending ? "Canceling..." : "Cancel Subscription"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Available Plans */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Available Plans</h2>
          
          {(!statusData?.subscription || statusData.subscription.cancelAtPeriodEnd) && (
            <div className="mb-6 max-w-sm">
              <label className="text-sm font-medium mb-1.5 block">Got a discount code?</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value)}
                  placeholder="Enter code" 
                  className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plansData?.plans.map(plan => {
              const isCurrentPlan = statusData?.subscription?.planId === plan.id;
              const isScheduledPlan = statusData?.subscription?.scheduledChange?.planId === plan.id;
              const isChanging = changePlanMutation.isPending;
              const isSubscribing = subscribeMutation.isPending;
              
              let btnText = "Subscribe";
              if (isCurrentPlan) btnText = "Current Plan";
              else if (isScheduledPlan) btnText = "Scheduled";
              else if (statusData?.subscription && !statusData.subscription.cancelAtPeriodEnd) btnText = "Change to Plan";

              if (isSubscribing || isChanging) btnText = "Processing...";

              return (
                <div key={plan.id} className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col">
                  <div className="mb-4">
                    <span className="inline-flex px-2 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-medium uppercase mb-3">
                      {plan.role}
                    </span>
                    <h3 className="text-xl font-bold">{plan.name}</h3>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-2xl font-bold">₹{(plan.amountPaise / 100).toFixed(0)}</span>
                      <span className="text-muted-foreground text-sm">/{plan.cycle}</span>
                    </div>
                  </div>
                  
                  <div className="mt-auto pt-6">
                    <button
                      disabled={isCurrentPlan || isScheduledPlan || isSubscribing || isChanging || (!plansData.checkoutAvailable && !statusData?.subscription)}
                      onClick={() => handleSubscribe(plan.id)}
                      className="w-full py-2.5 px-4 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {btnText}
                    </button>
                  </div>
                </div>
              );
            })}
            
            {(!plansData?.plans || plansData.plans.length === 0) && (
              <div className="col-span-full py-12 text-center border border-dashed border-border rounded-xl bg-card/50">
                <CreditCard className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground">No plans currently available for your role.</p>
              </div>
            )}
          </div>
        </div>

        {/* Payment History */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Payment History</h2>
          {paymentsData?.payments && paymentsData.payments.length > 0 ? (
            <div className="bg-card border border-border rounded-xl shadow-sm divide-y divide-border overflow-hidden">
              {paymentsData.payments.map(payment => (
                <div key={payment.id} className="p-4 px-6 flex items-center justify-between hover:bg-foreground/5 transition-colors">
                  <div>
                    <div className="font-medium">₹{(payment.amountPaise / 100).toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">{format(new Date(payment.createdAt), "PPp")}</div>
                  </div>
                  <div className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    payment.status === 'captured' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'
                  }`}>
                    {payment.status}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center border border-dashed border-border rounded-xl bg-card/50">
              <p className="text-muted-foreground text-sm">No payment history available.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}