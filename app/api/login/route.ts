import { NextResponse } from "next/server";
import {
  checkPassword,
  checkAdminPassword,
  sessionCookieOptions,
  sessionToken,
  SESSION_COOKIE,
  ADMIN_SESSION_COOKIE,
} from "@/lib/auth";
import { appUrl } from "@/lib/http";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const isAdminLogin = checkAdminPassword(password);
  if (!checkPassword(password) && !isAdminLogin) {
    return NextResponse.redirect(appUrl(req, "/login?error=1"), { status: 303 });
  }
  const res = NextResponse.redirect(appUrl(req, "/"), { status: 303 });
  res.cookies.set(SESSION_COOKIE, sessionToken(), sessionCookieOptions());
  if (isAdminLogin) {
    res.cookies.set(ADMIN_SESSION_COOKIE, sessionToken(), sessionCookieOptions());
  }
  return res;
}
