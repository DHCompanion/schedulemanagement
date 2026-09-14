/**
 * The cross-tool join key for an activity: procurement stores this to link an
 * item to a schedule activity, and it must survive schedule re-imports. The
 * GUID and UID come straight from the MSP file and are stable across re-exports
 * of the same schedule; WBS codes are NOT (they renumber on any structural
 * edit), which is why the link must never key on wbsCode|name.
 *
 * Do not confuse this with canonicalActivityKey (wbsCode|name) — that stays the
 * schedule's INTERNAL threading key for progress/forecast and is unchanged.
 */
export function stableActivityKey(a: { externalGuid: string | null; externalUid: number }): string {
  return a.externalGuid ?? `uid:${a.externalUid}`;
}
