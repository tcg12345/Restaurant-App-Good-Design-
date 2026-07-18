/**
 * Custom-order splice for the Pantry drag-to-rank list.
 *
 * The visible list can be a FILTERED subset of the saved order (search,
 * cuisine/price/score filters). Moving one visible row must reorder ONLY
 * the moved id relative to its visible target inside the full saved order,
 * leaving every hidden (filtered-out) restaurant exactly where it was.
 * The old implementation rebuilt the order as [...visibleIds, ...rest],
 * which shoved all hidden restaurants behind the visible ones — silently
 * rewriting the user's global ranking whenever any filter was active.
 */
export function moveWithinCustomOrder(
  customOrder: string[],
  visibleIds: string[],
  from: number,
  to: number,
): string[] | null {
  if (from === to) return null;
  const movedId = visibleIds[from];
  const targetId = visibleIds[to];
  if (!movedId || !targetId) return null;
  const ids = [...customOrder];
  // Ratings that never made it into customOrder sort to the END of the
  // visible list (the sort treats missing as Infinity) — append them in
  // visible order so both endpoints have real positions to splice at.
  const present = new Set(ids);
  for (const id of visibleIds) {
    if (!present.has(id)) { ids.push(id); present.add(id); }
  }
  const fromIdx = ids.indexOf(movedId);
  ids.splice(fromIdx, 1);
  const targetIdx = ids.indexOf(targetId);
  // Moving DOWN lands after the target (the target shifts up past the
  // moved row); moving UP lands before it — matching what the user saw.
  ids.splice(from < to ? targetIdx + 1 : targetIdx, 0, movedId);
  return ids;
}
