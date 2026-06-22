"use client";

import { useState } from "react";

interface DeletedTask {
  name: string;
  wbsCode: string | null;
}

export function ExportPanel({ projectId }: { projectId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletedTasks, setDeletedTasks] = useState<DeletedTask[] | null>(null);

  async function generate() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDeletedTasks(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", projectId);
    const res = await fetch("/api/export", { method: "POST", body: fd });
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Export failed.");
      setBusy(false);
      return;
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const name = cd.match(/filename="([^"]+)"/)?.[1] ?? "schedule-updated.xml";
    const tasksHeader = res.headers.get("X-Deleted-Tasks");
    if (tasksHeader) {
      const parsed: DeletedTask[] = JSON.parse(tasksHeader);
      if (parsed.length > 0) setDeletedTasks(parsed);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="file" accept=".xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={!file || busy} onClick={generate} className="self-start rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Generating…" : "Generate updated file"}
      </button>
      {deletedTasks && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="mb-1 font-medium">
            This export replaces {deletedTasks.length} coarse activit{deletedTasks.length === 1 ? "y" : "ies"} with finer ones.
            After merging, manually delete these rows from MS Project:
          </p>
          <ul className="list-inside list-disc">
            {deletedTasks.map((t) => (
              <li key={`${t.wbsCode}-${t.name}`}>{t.name} (WBS {t.wbsCode ?? "—"})</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
