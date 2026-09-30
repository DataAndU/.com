import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Safety & Disclaimer · Pontreol" };

export default function SafetyPage() {
  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-5 py-10 space-y-6 leading-relaxed">
        <Link href="/home" className="text-sm text-primary">← Pontreol</Link>
        <h1 className="text-2xl font-semibold">Safety &amp; Disclaimer</h1>
        <p className="text-muted-foreground">Pontreol helps you find what’s available, where and when. Please read this before you book or meet anyone.</p>

        <section className="space-y-2">
          <h2 className="font-semibold">What Pontreol is</h2>
          <p>Pontreol is a marketplace that connects people. Listings for services, spaces and travel are created by independent users and providers, not by Pontreol. Unless a listing clearly says otherwise, Pontreol does not itself provide the service, space or trip.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Check before you rely on a listing</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Prices, descriptions, photos and availability come from the provider who posted them.</li>
            <li>Availability can change at any time. Confirm the time with the provider before you travel or pay.</li>
            <li>Agree the price, what is included and cancellation terms in chat before the job starts.</li>
            <li>A “Verified” badge means that person submitted an identity document that Pontreol reviewed. It is not a guarantee of their work.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Payments</h2>
          <p>Payments for bookings are arranged directly between you and the provider; Pontreol does not currently collect or hold booking payments. Paid Pontreol plans are paid to Pontreol through Razorpay. Keep receipts for anything you pay.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Stay safe</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Keep conversations in Pontreol chat until you are comfortable.</li>
            <li>Meet in public or share your booking status with family (Booking → Share with family).</li>
            <li>Never share OTPs, passwords or bank PINs with anyone.</li>
            <li>In an emergency, call <a href="tel:112" className="text-primary font-semibold">112</a>, India&apos;s free emergency number for police, fire and ambulance.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Report a problem</h2>
          <p>If a listing looks suspicious, misleading or not allowed, open it and tap <b>Report listing</b>. Our team reviews reports and can hide listings or suspend accounts.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Your rights</h2>
          <p>You are responsible for deciding whether a provider or transaction is right for you. Nothing on this page limits any rights you have under applicable consumer protection or other laws that cannot be excluded.</p>
        </section>

        <p className="text-xs text-muted-foreground">This is general marketplace information, not legal advice.</p>
      </div>
    </main>
  );
}
