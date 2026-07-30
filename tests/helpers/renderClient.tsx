import { vi } from "vitest";

export interface StubbedCall {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Replaces global fetch with a queue of canned responses, recording what was
 * requested. Responses are consumed in order; the last one repeats once the
 * queue is exhausted, so a component that fires N identical requests needs only
 * one entry.
 */
export function stubFetch(...responses: { ok: boolean; body?: unknown }[]): { calls: StubbedCall[] } {
  const calls: StubbedCall[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return { ok: r.ok, json: async () => r.body ?? {} };
    }),
  );
  return { calls };
}

/** Components that gate a destructive action on window.confirm. */
export function stubConfirm(answer: boolean): ReturnType<typeof vi.fn> {
  const mock = vi.fn(() => answer);
  vi.stubGlobal("confirm", mock);
  return mock;
}
