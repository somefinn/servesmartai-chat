import { NextResponse } from "next/server";

export function middleware(req) {
  const basicAuth = req.headers.get("authorization");

  if (basicAuth) {
    const authValue = basicAuth.split(" ")[1];
    const [user, pwd] = atob(authValue).split(":");

    if (user === process.env.APP_USER && pwd === process.env.APP_PASSWORD) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Auth required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="Secure Area"`,
    },
  });
}

// Apply to everything ("/") — you can make this more selective if you want
export const config = {
  matcher: ["/((?!api).*)"], 
};
