# Pontreol verification guide

Use two separate browser profiles: one Buyer and one Provider. An administrator is a separate permission granted by the workspace operator; selecting Provider does not grant it. Do not use real payment details.

## 1. Sign-in and permanent roles

1. Open the app signed out. Marketplace pages must ask you to sign in.
2. Sign in with Google and select Buyer or Provider on first use.
3. Reload and sign out/in: the same role must remain selected.
4. A buyer must not be able to manage another person's listings. Non-administrators must not see admin navigation or access admin data.

## 2. Listings and discovery

1. As Provider, create a listing with the fields for its category and a location selected from address search.
2. As Buyer, find it on the map and through search, category, price, and distance filters.
3. Open its detail page. Edit, pause, restore, and delete it as its owner; existing booking history should survive deletion.
4. Photo uploads need App Storage. Reject more than six photos, files larger than 2 MiB, and invalid images; do not assume an upload succeeded after an error.

## 3. Category bookings, in order

- **Services:** Book a fixed-price service; request a negotiable service, send a provider quote, and accept/decline it as Buyer.
- **Spaces:** Add provider availability; book daily and hourly intervals. Try an overlapping interval from another buyer: only one booking should succeed.
- **Equipment:** Book a date range, independently toggle operator requested, and check that overlapping reservations are rejected.
- **Delivery:** Supply pickup/drop-off and an item description. The provider advances Requested → Picked Up → En Route → Delivered. The route is static, not live GPS tracking.
- **Travel:** Publish a route, departure time and seat count; search matching routes and request seats. Concurrent requests cannot reserve more seats than offered.

## 4. Conversations, verification, and reviews

1. Open a conversation/contact from a listing. Reopening the same qualifying contact must not use another monthly allowance.
2. Send messages in both browser profiles and check polling updates. A third account must not read the thread.
3. Submit a single ID image no larger than 200 KiB. Only its owner and administrators can view it.
4. Review the submission as an administrator. Check pending/verified/rejected states and a rejection reason.
5. For a booking, mark completion as each participant. Reviews must remain locked until both have completed it.
6. Enable foreground browser notifications only if wanted. Email delivery requires a verified Resend sender/domain; an in-app notification is not proof of email delivery.

## 5. Test subscriptions, last

An administrator configures plans, discounts and the free monthly contact limit. No made-up paid plans or revenue are seeded.

1. Add **Razorpay test** credentials through workspace Secrets, not chat. Configure the signed webhook endpoint `/api/billing/webhook`.
2. Subscribe through test Checkout and inspect billing history after authoritative verification.
3. Test cancellation and supported same-cycle changes scheduled for the next cycle. Cross-cycle changes have explicit provider restrictions; there is no silent proration.
4. Check renewal failures, duplicate webhook delivery and repeated payment IDs. These must not double-count revenue or grant duplicate access.

## Operational prerequisites

- App Storage must be provisioned before listing photos or private ID uploads can work.
- Resend's sender/domain must be verified before setting `RESEND_FROM`. Do not send unsolicited test email.
- Razorpay defaults to `RAZORPAY_MODE=test` and accepts only matching `RAZORPAY_TEST_*` secrets. Live payment activation requires separate operational approval, explicit `RAZORPAY_MODE=live`, all distinct `RAZORPAY_LIVE_*` credentials, and a final real-charge confirmation in the UI. Never use a live checkout for routine testing.
- Production schema changes require an explicit migration; the development schema command must not be used against production.

## Performance / mobile checks (Android Chrome)

1. Fresh profile, open `/home`: the permission prompt appears; while it is open the map area shows a spinner and **no** `/api/home/summary` request is made (DevTools → Network).
2. Allow: exactly one `/api/home/summary?...&view=map` request for your real coordinates.
3. Deny (or block in site settings): no summary request; the page explains how to search an address; searching loads listings for that place.
4. Navigate Map → Discover → Messages → Map: `/api/me` is requested once per 5 minutes at most (not on every navigation), and returning to Map reuses the cached result.
5. Sign out, then sign in as a different account: no data from the first account is shown (the query cache is cleared on user change).
6. Sign-in page renders the Clerk form on Android Chrome (the proxy still forces `Accept-Encoding: identity`).

## Automated checks

The backend tests isolate marketplace records in a temporary PostgreSQL schema and use test-only identity overrides. They do not bypass production authentication or prove a real Google OAuth or Razorpay sandbox checkout succeeded. Test payments are isolated from live paid access, payment history, webhook receipts, and live revenue.