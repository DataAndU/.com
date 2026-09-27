// Process readiness only: no database, session, or external service dependency.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, {
    headers: { "Cache-Control": "no-store" },
  });
}