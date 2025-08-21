// middleware.js  (Next.js Edge Middleware)
// NOTE: This only runs if your Vercel project is a Next.js app.
// It protects everything except common static assets.

import { NextResponse } from "next/server";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};

export function middleware(req) {
  const USER = process.env.APP_USER;
  const PASS = process.env.APP_PASS;

  // If not configured, don't block the site
  if (!USER || !PASS) return NextResponse.next();

  const auth = req.headers.get("authorization") || "";

  if (auth.startsWith("Basic ")) {
    try {
      const [user, pass] = atob(auth.slice(6)).split(":");
      if (user === USER && pass === PASS) {
        return NextResponse.next();
      }
    } catch {
      // fall through to challenge
    }
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="ServeSmartAI"',
      "Cache-Control": "no-store",
    },
  });
}
