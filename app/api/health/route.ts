export const dynamic = "force-dynamic";

/**
 * Lightweight deployment probe. It intentionally does not require a session
 * or touch D1, so the hosting platform can check the worker before a user
 * signs in. Protected application data remains behind /api/state.
 */
export async function GET() {
  return Response.json({
    ok: true,
    service: "bingo-control-promax",
    timestamp: new Date().toISOString(),
  });
}
