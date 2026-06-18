export const SESSION_COOKIE = "sms_session";

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD ?? "";
  return expected.length > 0 && input === expected;
}

export function sessionToken(): string {
  return process.env.APP_SESSION_TOKEN ?? "";
}

export function isAuthed(cookieValue: string | undefined): boolean {
  const token = sessionToken();
  return token.length > 0 && cookieValue === token;
}
