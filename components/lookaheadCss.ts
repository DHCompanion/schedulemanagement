// The lookahead is the one print-first surface in the app, so it carries its own
// CSS instead of Tailwind: @page, break-inside and print-color-adjust have no
// utility-class equivalent, and the PDF endpoint — which renders this markup
// standalone inside headless Chromium — must not depend on a hashed build asset.
const PAGE = { tabloid: "17in 11in", letter: "11in 8.5in" } as const;

export function lookaheadCss(size: "tabloid" | "letter"): string {
  return `
@page { size: ${PAGE[size]}; margin: 0.4in; }
.sheet, .sheet * { box-sizing: border-box; }
.sheet { font: 11px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet p, .sheet h2, .sheet ul { margin: 0; }
.hd { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 6px; }
.hd-brand { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.hd-title { font-size: 16px; font-weight: 700; }
.hd-meta { font-size: 10px; color: #475569; text-align: right; white-space: nowrap; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; }
.stat { border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; text-align: center; }
.stat-n { font-size: 18px; font-weight: 700; }
.stat-n.bad { color: #dc2626; }
.stat-n.warn { color: #b45309; }
.stat-l { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
.box { border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px 10px; margin-bottom: 10px; }
.box h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; margin-bottom: 4px; }
.box ul { padding-left: 16px; }
.box li { margin: 1px 0; }
.ms { display: flex; flex-wrap: wrap; gap: 6px; }
.ms-chip { border: 1px solid #cbd5e1; border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
.ms-chip.beyond { border-style: dashed; color: #475569; }
.ms-drift { color: #dc2626; font-weight: 700; }
.pagebreak { break-before: page; }
.axis { display: flex; border-bottom: 1px solid #94a3b8; font-size: 9px; color: #64748b; }
.axis-name { flex: 0 0 26%; font-weight: 600; }
.axis-time { position: relative; flex: 1; height: 14px; }
.axis-time span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.band { break-inside: avoid; margin-top: 8px; }
.band-hd { display: flex; justify-content: space-between; gap: 12px; padding: 3px 6px; font-weight: 700; border-radius: 3px 3px 0 0; }
.band-partners { font-weight: 400; font-size: 9px; }
.row { display: flex; align-items: stretch; border-bottom: 1px solid #e2e8f0; break-inside: avoid; }
.row-name { flex: 0 0 26%; padding: 3px 6px; }
.row-name .alt { color: #94a3b8; font-size: 9px; margin-left: 4px; }
.row-name .risk { color: #b45309; font-weight: 700; font-size: 9px; margin-left: 4px; }
.row-name .crit { color: #b91c1c; font-weight: 600; }
.row-time { position: relative; flex: 1; min-height: 16px; }
.wknd { position: absolute; top: 0; bottom: 0; background: #f1f5f9; }
.today { position: absolute; top: 0; bottom: 0; width: 1px; background: #0891b2; }
.bar { position: absolute; top: 5px; height: 8px; border-radius: 2px; background: #67aebf; overflow: hidden; }
.bar-fill { height: 100%; background: #155e75; }
.ghost { position: absolute; top: 3px; width: 1px; height: 12px; background: #94a3b8; }
.drift { position: absolute; top: 3px; font-size: 9px; font-weight: 700; color: #dc2626; transform: translateX(3px); }
/* Diamonds are drawn, not typed: the headless font bundle has no ◇/◆ glyph, so
   a character would silently vanish from the PDF. */
.dia { position: absolute; top: 5px; width: 7px; height: 7px; transform: translateX(-50%) rotate(45deg); }
.dia.planned { border: 1px solid #94a3b8; background: #fff; }
.dia.expected { background: #4338ca; }
.mark { display: inline-block; width: 7px; height: 7px; transform: rotate(45deg); margin: 0 3px 0 1px; }
.mark.planned { border: 1px solid #94a3b8; }
.mark.expected { background: #4338ca; }
.empty { padding: 16px; text-align: center; color: #64748b; }
.foot { margin-top: 10px; font-size: 9px; color: #64748b; text-align: right; }
@media print { .no-print { display: none !important; } }
`.trim();
}
