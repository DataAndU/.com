// Private subprocess transport for the Python notification outbox.
// No credentials or message contents are written to logs.
import { ReplitConnectors } from "@replit/connectors-sdk";

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 100_000) throw new Error("Notification is too large");
  }
  const { from, to, subject, text, idempotencyKey } = JSON.parse(input);
  if (![from, to, subject, text, idempotencyKey].every(v => typeof v === "string" && v.length)) {
    throw new Error("Missing notification fields");
  }
  const response = await new ReplitConnectors().proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: { from, to: [to], subject, text },
  });
  if (!response.ok) {
    process.stdout.write(JSON.stringify({ error: "Email provider rejected the notification", status: response.status }));
    process.exitCode = 1;
  } else {
    const result = await response.json();
    process.stdout.write(JSON.stringify({ id: result.id }));
  }
} catch {
  process.stdout.write(JSON.stringify({ error: "Email delivery failed; notification remains queued" }));
  process.exitCode = 1;
}