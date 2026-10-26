import { NextResponse } from "next/server";
import { appUrl } from "@/lib/http";
import { isAdminRequest } from "@/lib/scope";
import { recomputeBenchmarks } from "@/lib/benchmarks/benchmarkService";

// Rebuilds every duration benchmark from the imported schedules (roadmap Q68). Admin only.
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: { message: "Admin access required." } }, { status: 403 });
  await recomputeBenchmarks();
  return NextResponse.redirect(appUrl(req, "/history"), { status: 303 });
}
