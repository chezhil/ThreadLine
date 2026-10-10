import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "threadline_session";

const PUBLIC_PATHS = ["/login", "/track", "/manifest.json", "/icon.svg", "/sw.js"];
const PUBLIC_API_PREFIXES = ["/api/auth/login", "/api/track", "/api/health"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));

  if (isPublic) return NextResponse.next();

  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (!hasSession && pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasSession) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
