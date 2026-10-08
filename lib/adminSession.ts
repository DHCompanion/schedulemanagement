import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { SCOPE_COOKIE, isAdminFromCookies } from "@/lib/scope";

/** Admin check for server components. Lives apart from lib/scope.ts, which also runs in edge middleware and must not import next/headers. */
export async function isAdminSession(): Promise<boolean> {
  const jar = await cookies();
  return isAdminFromCookies(jar.get(SESSION_COOKIE)?.value, jar.get(SCOPE_COOKIE)?.value, Math.floor(Date.now() / 1000));
}
