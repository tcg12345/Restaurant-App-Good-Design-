/** Keep the invite/link payload when a person adds a message to a share. */
export function composeShareMessage(
  note: string,
  payloadText?: string,
): string {
  return [note.trim(), payloadText?.trim()].filter(Boolean).join("\n\n");
}
