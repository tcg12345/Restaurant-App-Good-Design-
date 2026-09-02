/**
 * @mentions in comment bodies.
 *
 * Replying to someone puts "@their_handle " at the front of the draft (the
 * Instagram move), so a thread reads as a conversation between named people
 * rather than a stack of anonymous paragraphs. That only works if the
 * mention is then rendered AS a mention — otherwise the convention just
 * litters every reply with punctuation.
 *
 * Usernames in this app are `[A-Za-z0-9_]` (ProfileSetup enforces it), so
 * the token is unambiguous. The one thing worth being careful about is not
 * lighting up the domain half of an email address: a mention has to start
 * at a word boundary, which `foo@bar` does not.
 */

export type CommentSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; username: string };

/** Longest handle we'll light up. Beyond this it isn't a username. */
const MAX_HANDLE = 30;

const MENTION = new RegExp(`@([A-Za-z0-9_]{1,${MAX_HANDLE}})`, 'g');

/**
 * Split a comment body into plain text and mention tokens, in order.
 * Always returns at least one segment for a non-empty body, and never
 * drops or reorders characters — concatenating every `value` reproduces
 * the input exactly.
 */
export function parseCommentSegments(body: string): CommentSegment[] {
  const out: CommentSegment[] = [];
  if (!body) return out;
  let last = 0;
  MENTION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION.exec(body)) !== null) {
    const at = m.index;
    // A mention starts a word. Anything alphanumeric (or _) immediately
    // before the @ makes this the middle of something else — an email, a
    // handle already inside a longer token.
    const prev = at > 0 ? body[at - 1] : '';
    if (prev && /[A-Za-z0-9_]/.test(prev)) continue;
    if (at > last) out.push({ type: 'text', value: body.slice(last, at) });
    out.push({ type: 'mention', value: m[0], username: m[1] });
    last = at + m[0].length;
  }
  if (last < body.length) out.push({ type: 'text', value: body.slice(last) });
  return out;
}

/**
 * The draft a "Reply" tap should start from. Returns '' for a missing
 * handle rather than a bare "@ ", which would post as literal punctuation
 * and mention nobody.
 */
export function replyDraftFor(username?: string | null): string {
  const handle = (username || '').trim().replace(/^@+/, '');
  if (!handle || !/^[A-Za-z0-9_]+$/.test(handle)) return '';
  return `@${handle} `;
}
