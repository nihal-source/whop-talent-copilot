import { NextResponse } from "next/server";

/**
 * CORS for the Chrome extension. The extension calls a small set of endpoints
 * with a bearer token (not cookies), so we reflect the requesting origin and
 * allow the Authorization header. Only chrome-extension origins are permitted.
 */
function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (origin.startsWith("chrome-extension://")) return origin;
  return null;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = allowedOrigin(req);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function withCors(req: Request, res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}

export function preflight(req: Request): NextResponse {
  return withCors(req, new NextResponse(null, { status: 204 }));
}
