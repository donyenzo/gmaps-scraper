import { NextRequest, NextResponse } from "next/server";

// ─── SECURITY LAYER 4: CORS ────────────────────────────────────────────────
// Set ALLOWED_ORIGIN di Vercel env vars ke domain deployment kamu.
// Contoh: https://gmaps-scraper.vercel.app
// Jika kosong → hanya blok preflight dari origin asing (tidak blok same-origin).

const ALLOWED_METHODS  = "POST, OPTIONS";
const ALLOWED_HEADERS  = "Content-Type, Authorization";
const MAX_AGE          = "86400"; // 24 jam preflight cache

function getAllowedOrigin(requestOrigin: string | null): string {
  const configured = process.env.ALLOWED_ORIGIN?.trim();

  // Jika tidak ada konfigurasi, pakai wildcard (development only)
  if (!configured) return "*";

  // Izinkan exact match ATAU subdomain dari domain yang sama
  if (requestOrigin && requestOrigin === configured) return requestOrigin;

  // Selain itu tolak — kembalikan domain configured (browser akan blok sendiri)
  return configured;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Hanya terapkan ke /api/* routes
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  const origin = request.headers.get("origin");
  const allowedOrigin = getAllowedOrigin(origin);

  // Preflight request (OPTIONS) — balas langsung tanpa meneruskan ke handler
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":  allowedOrigin,
        "Access-Control-Allow-Methods": ALLOWED_METHODS,
        "Access-Control-Allow-Headers": ALLOWED_HEADERS,
        "Access-Control-Max-Age":       MAX_AGE,
      },
    });
  }

  // Request biasa — tambahkan CORS header ke response
  const response = NextResponse.next();
  response.headers.set("Access-Control-Allow-Origin",  allowedOrigin);
  response.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  // Cegah browser cache response API
  response.headers.set("Cache-Control", "no-store, no-cache");
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
