import { NextResponse } from "next/server";
import { appUrl } from "@/lib/http";
import { isAdminRequest } from "@/lib/scope";
import { addStandardScope, confirmMapping, settleName } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { deleteStandardScope, renameStandardScope } from "@/lib/normalize/renameStandardScope";

// The cross-project name review. Every action is global: map a name to an
// approved scope, approve a requested name onto the list, classify it as coarse
// or procurement, ignore it, add a standard name outright, or rename, merge or
// delete a standard name.
export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return error("Admin access required.", 403);
  const form = await req.formData();
  const min = String(form.get("min") ?? "");
  const back = NextResponse.redirect(appUrl(req, `/history/names${/^\d+$/.test(min) ? `?min=${min}` : ""}`), { status: 303 });

  const newScope = String(form.get("newScope") ?? "");
  if (newScope.trim()) {
    await addStandardScope(newScope);
    return back;
  }

  if (form.get("rename") || form.get("deleteScope")) {
    const from = String(form.get("from") ?? "");
    try {
      if (form.get("deleteScope")) await deleteStandardScope(from);
      else await renameStandardScope(from, String(form.get("to") ?? ""));
    } catch (e) {
      return error(e instanceof Error ? e.message : "Failed to save.", 422);
    }
    return back;
  }

  const name = String(form.get("name") ?? "");
  const normalizedName = normalizeName(name);
  if (!normalizedName) return error("name is required.", 422);
  const kind = String(form.get("class") ?? "");

  if (form.get("ignore")) await settleName(normalizedName, { ignore: true });
  else if (kind) {
    if (kind !== "coarse" && kind !== "procurement") return error("class must be coarse or procurement.", 422);
    await settleName(normalizedName, { class: kind, covers: [] });
  } else if (form.get("approve")) {
    await settleName(normalizedName, { mapTo: await addStandardScope(name) });
  } else {
    const scope = String(form.get("scope") ?? "").trim();
    if (!scope) return error("Pick a standard name.", 422);
    try {
      await confirmMapping(name, scope);
    } catch (e) {
      return error(e instanceof Error ? e.message : "Failed to save.", 422);
    }
  }
  return back;
}

function error(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}
