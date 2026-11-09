import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, safeEqual, sessionValue } from "@/lib/auth";

/** Gate the web UI behind the session cookie. API routes do their own bearer/cookie check. */
export async function proxy(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && safeEqual(cookie, await sessionValue())) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/|login|_next/|favicon|manifest|icon).*)"],
};
