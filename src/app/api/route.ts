import { NextResponse } from "next/server";

/**
 * GET /api — basic healthcheck endpoint.
 *
 * Returns JSON: { ok, status, version, uptime }.
 * - ok: true if the process is alive and responding.
 * - status: 'healthy' (liveness probe); extend with degraded/error states later.
 * - version: pinned to 0.2.0 (matches package.json version per audit Pass 1 P3-2).
 * - uptime: process.uptime() in seconds — useful for diagnosing long-running
 *   dev server vs fresh restart.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    status: "healthy",
    version: "0.2.0",
    uptime: process.uptime(),
  });
}
