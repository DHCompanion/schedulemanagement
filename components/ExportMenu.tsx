import Link from "next/link";

// Record-keeping and meeting output live together (spec §2). A native
// <details> dropdown — no client JS. Page size is chosen on the lookahead route
// itself, which keeps this menu to the two windows people actually ask for.
export function ExportMenu({ projectId }: { projectId: string }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Export ▾
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
        <Link href={`/projects/${projectId}/lookahead?weeks=3`} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          3-Week Lookahead
        </Link>
        <Link href={`/projects/${projectId}/lookahead?weeks=6`} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          6-Week Lookahead
        </Link>
        <div className="my-1 border-t border-slate-100" />
        <Link href={`/projects/${projectId}/export`} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          MS Project XML
        </Link>
      </div>
    </details>
  );
}
