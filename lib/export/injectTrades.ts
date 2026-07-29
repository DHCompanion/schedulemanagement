export interface TradeForExport {
  disciplineName: string;
  partnerName: string | null;
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as AnyRec[];
}

// MSPDI task text fields. Text1 is 188743731 and each subsequent slot is +3.
const TEXT1_FIELD_ID = 188743731;
const TEXT_SLOTS = 30;

/** Text field ids the uploaded file already declares — never overwrite a customer's own column. */
function usedFieldIds(project: AnyRec): Set<string> {
  const declared = asArray((project.ExtendedAttributes as AnyRec | undefined)?.ExtendedAttribute);
  return new Set(declared.map((d) => String(d.FieldID)));
}

function freeSlots(project: AnyRec, count: number): string[] {
  const used = usedFieldIds(project);
  const free: string[] = [];
  for (let i = 0; i < TEXT_SLOTS && free.length < count; i += 1) {
    const id = String(TEXT1_FIELD_ID + i * 3);
    if (!used.has(id)) free.push(id);
  }
  return free;
}

/**
 * Writes each activity's discipline and trade partner into the exported file as
 * two custom columns, so the schedule carries who is doing the work into MS
 * Project — and so a later import can read them back and flag what changed.
 *
 * The aliases are the round-trip contract: the importer keys customFields by
 * alias, not by field id, because the id it lands in depends on which slots the
 * customer's own file already occupies.
 */
export function injectTrades(doc: AnyRec, tradeByUid: Map<number, TradeForExport>): AnyRec {
  if (tradeByUid.size === 0) return doc;
  const project = doc.Project as AnyRec | undefined;
  if (!project) return doc;

  const [disciplineId, partnerId] = freeSlots(project, 2);
  if (!disciplineId || !partnerId) return doc;

  const definitions = asArray((project.ExtendedAttributes as AnyRec | undefined)?.ExtendedAttribute);
  definitions.push(
    { FieldID: disciplineId, FieldName: `Text${(Number(disciplineId) - TEXT1_FIELD_ID) / 3 + 1}`, Alias: "Discipline" },
    { FieldID: partnerId, FieldName: `Text${(Number(partnerId) - TEXT1_FIELD_ID) / 3 + 1}`, Alias: "Trade Partner" },
  );
  project.ExtendedAttributes = { ExtendedAttribute: definitions };

  const tasksNode = project.Tasks as AnyRec | undefined;
  for (const task of asArray(tasksNode?.Task)) {
    const trade = tradeByUid.get(Number(task.UID));
    if (!trade) continue;
    const attrs = asArray(task.ExtendedAttribute);
    attrs.push({ FieldID: disciplineId, Value: trade.disciplineName });
    if (trade.partnerName) attrs.push({ FieldID: partnerId, Value: trade.partnerName });
    task.ExtendedAttribute = attrs;
  }
  return doc;
}
