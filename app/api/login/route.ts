import { NextResponse } from "next/server";
import { checkPassword, sessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  // Behind Railway's proxy req.url's host is the internal bind address
  // (localhost:8080), so build redirect URLs from the forwarded host instead.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const base = host ? `${proto}://${host}` : req.url;
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  if (!checkPassword(password)) {
    return NextResponse.redirect(new URL("/login?error=1", base), { status: 303 });
  }
  const res = NextResponse.redirect(new URL("/", base), { status: 303 });
  res.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
