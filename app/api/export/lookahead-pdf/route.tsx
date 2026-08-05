import { NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";
import { LookaheadSheet } from "@/components/LookaheadSheet";
import { lookaheadCss } from "@/components/lookaheadCss";
import { getLookahead, parseSize, parseWeeks } from "@/lib/lookahead/getLookahead";
import { lookaheadDocument, pdfFileName } from "@/lib/lookahead/pdfDocument";
import { denyIfOutOfScope } from "@/lib/scope";

// Chromium cold-starts slowly on a first invocation; the platform default is not
// enough room for the launch plus the render.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  if (!projectId) {
    return NextResponse.json({ error: { message: "projectId is required." } }, { status: 400 });
  }
  const denied = await denyIfOutOfScope(req, projectId);
  if (denied) return denied;

  const weeks = parseWeeks(url.searchParams.get("weeks") ?? undefined);
  const size = parseSize(url.searchParams.get("size") ?? undefined);
  const today = new Date();

  const payload = await getLookahead(projectId, weeks, today);
  if (!payload) {
    return NextResponse.json({ error: { message: "No schedule imported for this project." } }, { status: 404 });
  }

  // Imported here, not at the top: Next rejects a static react-dom/server import
  // in the app directory, and this is a route handler that genuinely needs it.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = lookaheadDocument(
    renderToStaticMarkup(<LookaheadSheet view={payload.view} projectName={payload.projectName} />),
    lookaheadCss(size),
  );

  // Local and self-hosted runs point at an installed browser; on the serverless
  // platform the @sparticuz build is the only Chromium present.
  const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? (await chromium.executablePath());
  const browser = await playwright.launch({ args: chromium.args, executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;padding:0 .4in;font:8px sans-serif;color:#64748b;text-align:right;">Exported from Schedule Manager · page <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
      margin: { top: "0.4in", bottom: "0.5in", left: "0.4in", right: "0.4in" },
    });
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFileName(payload.projectName, weeks, today)}"`,
      },
    });
  } finally {
    await browser.close();
  }
}
