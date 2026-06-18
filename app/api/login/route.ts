import { NextResponse } from "next/server";
import { checkPassword, sessionToken, SESSION_COOKIE } from "@/lib/auth";
import { requestBaseUrl } from "@/lib/http";

export async function POST(req: Request) {
  const base = requestBaseUrl(req);
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
