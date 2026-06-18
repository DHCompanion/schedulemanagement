"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Preview {
  title: string;
  statusDate: string | null;
  suggestedIsBaseline: boolean;
  counts: { activities: number; milestones: number; relationships: number; resources: number };
  fieldDefinitions: { alias: string; fieldName: string }[];
  warnings: string[];
}

export function ImportWizard({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [statusDate, setStatusDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runPreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/imports/preview", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Preview failed.");
      return;
    }
    const data: Preview = await res.json();
    setPreview(data);
    setStatusDate(data.statusDate ? data.statusDate.slice(0, 16) : "");
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", projectId);
    if (statusDate) fd.append("statusDate", `${statusDate}:00`);
    const res = await fetch("/api/imports/commit", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Import failed.");
      return;
    }
    router.push(`/projects/${projectId}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        type="file"
        accept=".xml"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setPreview(null);
        }}
        className="text-sm"
      />
      {file && !preview && (
        <button onClick={runPreview} disabled={busy} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Reading…" : "Preview import"}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {preview && (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm">
          <p className="mb-2 font-medium">{preview.title}</p>
          <ul className="mb-3 grid grid-cols-2 gap-1 text-slate-600">
            <li>Activities: {preview.counts.activities}</li>
            <li>Milestones: {preview.counts.milestones}</li>
            <li>Relationships: {preview.counts.relationships}</li>
            <li>Resources: {preview.counts.resources}</li>
          </ul>
          <p className="mb-2 text-slate-600">
            Baseline detected: {preview.suggestedIsBaseline ? "no (this import will be the baseline)" : "yes"}
          </p>
          {preview.fieldDefinitions.length > 0 && (
            <p className="mb-2 text-slate-600">
              Custom fields: {preview.fieldDefinitions.map((f) => `${f.fieldName}=${f.alias}`).join(", ")}
            </p>
          )}
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-slate-600">Status (data) date {preview.statusDate ? "" : "— not found in file, please set"}</span>
            <input
              type="datetime-local"
              value={statusDate}
              onChange={(e) => setStatusDate(e.target.value)}
              className="rounded border border-slate-300 px-3 py-2"
            />
          </label>
          {preview.warnings.length > 0 && (
            <p className="mb-3 text-amber-600">{preview.warnings.length} warning(s).</p>
          )}
          <button onClick={commit} disabled={busy} className="rounded bg-emerald-700 px-3 py-2 font-medium text-white disabled:opacity-50">
            {busy ? "Importing…" : "Commit import"}
          </button>
        </div>
      )}
    </div>
  );
}
