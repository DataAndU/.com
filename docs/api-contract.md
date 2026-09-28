# Pontreol API contract

Base URL: `/api`. JSON fields are **camelCase**. IDs are UUID strings. Timestamps are
RFC 3339 UTC strings. Browser authentication is Pontreol's own opaque, HttpOnly
session cookie issued after email one-time-code sign-in (`/api/auth/*`); clients must
not send a user ID or role. All endpoints except `GET /healthz`, `GET /readyz`,
`POST /billing/webhook` and `POST /auth/otp/*` require authentication. Mutations require a same-origin `Origin` or `Sec-Fetch-Site: same-origin`
header (requests with neither are rejected) and JSON unless the contract says otherwise. Errors are `{ "detail": string }`.

## Shared shapes

`User`: `{ id, email, displayName, avatarUrl, role: "buyer"|"provider"|null, isAdmin, verificationStatus: "notStarted"|"pending"|"verified"|"rejected", rating, reviewCount, contactEmailVisible, contactPhoneVisible, phone, createdAt }`

`Listing`: `{ id, providerId, provider: ProviderSummary, category, title, description, price, pricingMode: "fixed"|"negotiable", currency: "INR", locationLabel, latitude, longitude, status: "active"|"paused", attributes, photos: Media[], distanceKm, viewCount, contactCount, createdAt, updatedAt }`.
Categories are `"services"|"spaces"|"equipment"|"delivery"|"travel"`.

Category `attributes` are exact camelCase objects:

- equipment: `{ equipmentType, condition, fuelType }`
- services: `{ serviceType, experienceYears, onSiteOrRemote: "onSite"|"remote"|"both" }`
- travel: `{ vehicleType, seatingCapacity, withDriver, originLabel, originLatitude, originLongitude, destinationLabel, destinationLatitude, destinationLongitude, departureAt, availableSeats }`
- delivery: `{ vehicleType, maxLoadCapacity, serviceRadiusKm }`
- spaces: `{ capacity, spaceType }`

`Media`: `{ id, objectPath, contentType, sizeBytes, status: "pending"|"ready" }`.
`Booking`: `{ id, listingId, buyerId, providerId, category, status, details, quotedPrice, createdAt, updatedAt }`.
`Page<T>`: `{ items: T[], nextCursor: string|null }`.

## Account, profiles, and notifications

| Method/path | Request | Success response |
|---|---|---|
| `GET /me` | — | `User` for the current session |
| `POST /auth/otp/request` | `{ email }` | `{ sent: true, expiresIn: 600, resendAfter: 60 }` (same for known and unknown emails); `429 rate_limited` + `Retry-After`; `503 email_send_failed`/`email_unavailable`; `422 invalid_email` |
| `POST /auth/otp/verify` | `{ email, code, next? }` | `{ next }` + session cookie; `400 invalid_code`/`expired_code`/`too_many_attempts`; `403 suspended`; `409 account_conflict`; `429 rate_limited` |
| `POST /auth/logout` | `{}` | `{ signedOut: true }`; revokes the server-side session |
| `PUT /me/role` | `{ role: "buyer"|"provider" }` | `User`; first value is permanent; conflicting/repeated concurrent selection is `409` |
| `PATCH /me` | `{ displayName?, phone?, contactEmailVisible?, contactPhoneVisible? }` | `User` |
| `GET /providers/{providerId}` | — | `{ provider: ProviderSummary, listings: Listing[], reviews: Review[] }` |
| `GET /notifications?cursor=&limit=` | — | `Page<Notification>` |
| `POST /notifications/{id}/read` | `{}` | `{ notification: Notification }` |
| `GET /notification-preferences` | — | `{ emailBookings, emailMessages, browserBookings, browserMessages }` |
| `PUT /notification-preferences` | same four booleans | same object |

`ProviderSummary`: `{ id, displayName, avatarUrl, verificationStatus, rating, reviewCount, contactEmail, contactPhone }`; contact fields are `null` unless the provider enabled them and the viewer passed the contact gate.
`Notification`: `{ id, type, title, body, resourceType, resourceId, readAt, createdAt }`.

## Geocoding, listings, and media

| Method/path | Request | Success response |
|---|---|---|
| `GET /geocode?q=` | query length 3–200 | `{ results: [{ label, latitude, longitude }] }`; server-cached/rate-limited Nominatim |
| `GET /home/summary?lat=&lng=&distanceKm=&view=` | optional coordinates (lat −90..90, lng −180..180, `distanceKm` 0 < d ≤ 500, default 25); `view=full` (default) or `map` | `{ totalListings, categories: [{ category, count }], nearbyListings: Listing[] }`. With coordinates: listings within `distanceKm` (great-circle), nearest first, max 200. Without: first 100 active listings, `distanceKm: null`. `view=map` returns compact pins `{ id, providerId, category, title, price, pricingMode, currency, latitude, longitude, status, distanceKm }` (no provider/photos/description) |
| `GET /listings?category=&search=&priceMin=&priceMax=&lat=&lng=&distanceKm=&sort=&cursor=&limit=` | sort `relevance|distance|priceLow|priceHigh` | `Page<Listing>` |
| `GET /listings/{id}` | — | `Listing` |
| `GET /my/listings` | provider only | `{ items: Listing[] }` |
| `POST /listings` | listing fields excluding server fields; exact category attributes above; `photoIds` max 6 | `201 Listing` |
| `PATCH /listings/{id}` | owned listing mutable fields, `photoIds?`, `status?` | `Listing` |
| `DELETE /listings/{id}` | — | `204` |
| `POST /media/uploads` | `{ purpose: "listingPhoto"|"verificationId", fileName, contentType: "image/jpeg"|"image/png"|"image/webp", sizeBytes }` | `{ mediaId, uploadUrl, objectPath, requiredHeaders }` |
| `POST /media/{id}/finalize` | `{}` | `{ media: Media }`; validates cloud object metadata before ready |
| `GET /media/{id}` | — | redirect/stream if authorized |

Listing photos are at most six and 2 MiB each. Verification IDs are private and at
most 200 KiB. If durable cloud storage is unavailable, media endpoints return `503`;
there is no local/ephemeral fallback.

## Availability and category bookings

All create/accept operations lock the relevant listing/availability rows. Conflicts
return `409`; clients must not assume a request succeeded after a conflict.

| Method/path | Request | Success response |
|---|---|---|
| `GET /listings/{id}/availability?from=&to=` | RFC 3339 range | `{ slots: [{ startsAt, endsAt, available }] }` |
| `PUT /listings/{id}/availability` | provider: `{ timezone, slots: [{ startsAt, endsAt }] }` | same |
| `POST /bookings/services` | buyer: `{ listingId, requestedAt, note? }` | `201 Booking`; fixed → `confirmed`, negotiable → `requested` |
| `POST /bookings/{id}/quote` | provider: `{ quotedPrice, message? }` | `Booking` status `quoted` |
| `POST /bookings/{id}/quote-response` | buyer: `{ accept: boolean }` | `Booking` status `confirmed|declined` |
| `POST /bookings/spaces` | buyer: `{ listingId, mode: "daily"|"hourly", checkIn, checkOut, note? }` | `201 Booking` |
| `POST /bookings/equipment` | buyer: `{ listingId, startsAt, endsAt, operatorRequested, note? }` | `201 Booking` |
| `POST /bookings/delivery` | buyer: `{ listingId, pickup: Location, dropoff: Location, pickupAt, itemDescription, loadKg?, note? }` | `201 Booking` |
| `POST /bookings/travel` | buyer: `{ listingId, seats, note? }` | `201 Booking`; seats reserved atomically |
| `GET /bookings?role=&category=&status=&cursor=&limit=` | own requests only | `Page<Booking>` |
| `GET /bookings/{id}` | participant only | `{ booking: Booking, route: { geometry, provider }|null }` |
| `POST /bookings/{id}/status` | `{ status }` | `Booking` |
| `POST /bookings/{id}/complete` | `{}` | `Booking` |

`Location`: `{ label, latitude, longitude }`. Delivery provider transitions are only
`requested → pickedUp → enRoute → delivered`; cancellation rules are server enforced.
Other booking statuses are `requested|quoted|confirmed|declined|cancelled|completed`.
Completion is recorded separately per participant and becomes mutual when both mark it.
Travel listing searches use `originLat`, `originLng`, `destinationLat`,
`destinationLng`, `departureFrom`, `departureTo`, and `seats` on `GET /listings`.

## Messaging and contact gate

| Method/path | Request | Success response |
|---|---|---|
| `GET /conversations?cursor=&limit=` | — | `Page<Conversation>` |
| `POST /conversations` | `{ listingId, providerId, initialMessage }` | `201 { conversation, message, usage }`; idempotent for same buyer/provider/listing |
| `GET /conversations/{id}/messages?after=&limit=` | participant only | `{ messages: Message[], nextAfter }` |
| `POST /conversations/{id}/messages` | `{ text }` | `201 Message` |
| `POST /listings/{id}/contact` | `{}` | `{ provider: ProviderSummary, usage }`; same listing/provider does not charge twice |
| `GET /contact-usage` | — | `{ period: "YYYY-MM", used, limit, paid, remaining }` |

`Conversation`: `{ id, listingId, buyerId, providerId, lastMessageAt, lastMessagePreview, unreadCount, createdAt }`.
`Message`: `{ id, conversationId, senderId, text, createdAt }`.
Free-buyer monthly conversation/contact usage is one atomic unique qualification per
buyer/provider/listing; paid users are not limited.

## Verification, reviews, and admin

| Method/path | Request | Success response |
|---|---|---|
| `GET /verification` | — | `{ status, submittedAt, reviewedAt, rejectionReason }` |
| `POST /verification` | `{ legalName, idType, idMediaId }` | `201 { status: "pending", submittedAt }` |
| `POST /bookings/{id}/reviews` | `{ rating: 1..5, comment }` | `201 Review`; only after mutual completion, once per author/booking |
| `GET /admin/verifications?status=&cursor=&limit=` | admin | `Page<VerificationAdmin>` |
| `POST /admin/verifications/{id}/decision` | `{ decision: "verified"|"rejected", reason? }` | `{ verification: VerificationAdmin }` |
| `GET /admin/users?search=&role=&cursor=&limit=` | admin | `Page<User>` |
| `POST /admin/users/{id}/suspend` | `{ suspended: boolean, reason }` | `{ user: User }` |
| `GET /admin/listings?status=&cursor=&limit=` | admin | `Page<Listing>` |
| `POST /admin/listings/{id}/moderate` | `{ action: "pause"|"restore"|"delete", reason }` | `{ listing: Listing|null }` |
| `GET /admin/audit?cursor=&limit=` | admin | `Page<AuditRecord>` |

`Review`: `{ id, bookingId, authorId, subjectId, rating, comment, createdAt }`.
Admin is a separate `isAdmin` database flag and is never accepted by account/update
APIs. Every admin mutation writes `AuditRecord`:
`{ id, adminUserId, action, targetType, targetId, metadata, createdAt }`.

## Billing

Billing bodies and responses are camelCase and follow `docs/billing-contract.md`.
Endpoints are:
`GET /billing/plans`, `GET /billing/status`, `POST /billing/subscribe`,
`POST /billing/verify`, `POST /billing/cancel`, `POST /billing/change-plan`,
`GET /billing/payments`, `POST /billing/webhook`,
`GET|POST /admin/billing/plans`, `PUT /admin/billing/plans/{id}`,
`GET|POST /admin/billing/discounts`, `PUT /admin/billing/discounts/{id}`,
`GET|PUT /admin/billing/settings`, and `GET /admin/billing/revenue`.

## Operational endpoints

- `GET /healthz` → `{ "status": "ok" }`.
- Notification emails are persisted to an outbox before invoking the existing Resend
  bridge. Failures remain retryable and never roll back the marketplace transaction.