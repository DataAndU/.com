import Link from "next/link";

/** Short, unobtrusive marketplace notice for listing, booking and payment screens. */
export function MarketplaceNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-muted-foreground ${className}`}>
      Pontreol connects independent users and does not itself provide the listed service, space, delivery or travel.
      Confirm details, availability and price with the other person before proceeding.{" "}
      <Link href="/safety" className="underline">Safety &amp; Disclaimer</Link>
    </p>
  );
}
