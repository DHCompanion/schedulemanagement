import Link from "next/link";
import { notFound } from "next/navigation";
import { LookaheadSheet } from "@/components/LookaheadSheet";
import { lookaheadCss } from "@/components/lookaheadCss";
import { appPath } from "@/lib/http";
import { getLookahead, parseSize, parseWeeks } from "@/lib/lookahead/getLookahead";

export const dynamic = "force-dynamic";

// One route serves screen and paper (spec §4): what you see here is what prints,
// and what the PDF endpoint renders. The toolbar is the only screen-only part.
export default async function LookaheadPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ weeks?: string; size?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const weeks = parseWeeks(sp.weeks);
  const size = parseSize(sp.size);

  const payload = await getLookahead(id, weeks, new Date());
  if (!payload) notFound();

  const href = (w: number, s: string) => `/projects/${id}/lookahead?weeks=${w}&size=${s}`;
  const tab = (active: boolean) =>
    `rounded border px-2 py-1 ${active ? "border-cyan-700 bg-cyan-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: lookaheadCss(size) }} />
      <div className="no-print mx-auto flex max-w-5xl flex-wrap items-center gap-2 p-4 text-sm">
        <Link href={`/projects/${id}`} className="mr-auto text-cyan-700 hover:underline">
          ← Schedule
        </Link>
        <Link href={href(3, size)} className={tab(weeks === 3)}>
          3 wk
        </Link>
        <Link href={href(6, size)} className={tab(weeks === 6)}>
          6 wk
        </Link>
        <span className="mx-1 text-slate-300">|</span>
        <Link href={href(weeks, "tabloid")} className={tab(size === "tabloid")}>
          11×17
        </Link>
        <Link href={href(weeks, "letter")} className={tab(size === "letter")}>
          Letter
        </Link>
        <a
          href={appPath(`/api/export/lookahead-pdf?projectId=${id}&weeks=${weeks}&size=${size}`)}
          className="rounded-lg bg-cyan-700 px-3 py-1.5 font-medium text-white hover:bg-cyan-800"
        >
          Download PDF
        </a>
      </div>
      <div className="mx-auto max-w-[17in] p-4 print:p-0">
        <LookaheadSheet view={payload.view} projectName={payload.projectName} />
      </div>
    </>
  );
}
