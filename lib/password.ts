import { timingSafeEqual } from "node:crypto";

// Separate from lib/auth.ts on purpose: auth.ts is imported by edge middleware,
// where node:crypto does not exist. Only the login route needs these, and it
// runs in the Node runtime.

// Constant-time so a wrong password can't be narrowed a character at a time by
// timing the response. Comparing byte lengths first is safe to leak — password
// length is not the secret, and timingSafeEqual requires equal-length buffers.
function secretEquals(input: string, expected: string): boolean {
  if (expected.length === 0) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkPassword(input: string): boolean {
  return secretEquals(input, process.env.APP_PASSWORD ?? "");
}

export function checkAdminPassword(input: string): boolean {
  return secretEquals(input, process.env.APP_ADMIN_PASSWORD ?? "");
}
