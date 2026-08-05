/**
 * The PDF is produced from a standalone document handed to Chromium via
 * setContent — not by navigating to the route. That keeps the endpoint free of a
 * base URL, a session cookie, and the hashed CSS asset, and it is why the sheet
 * carries its own stylesheet.
 */
export function lookaheadDocument(bodyHtml: string, css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${bodyHtml}</body></html>`;
}

export function pdfFileName(projectName: string, weeks: number, today: Date): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return `${slug}-${weeks}wk-lookahead-${today.toISOString().slice(0, 10)}.pdf`;
}
