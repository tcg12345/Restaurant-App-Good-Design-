import { describe, it, expect } from 'vitest';
import { parseCommentSegments, replyDraftFor } from './comment-text';

const kinds = (body: string) => parseCommentSegments(body).map((s) => `${s.type}:${s.value}`);

describe('parseCommentSegments', () => {
  it('returns nothing for an empty body', () => {
    expect(parseCommentSegments('')).toEqual([]);
  });

  it('leaves a plain comment as one text segment', () => {
    expect(kinds('great spot')).toEqual(['text:great spot']);
  });

  it('lights up a leading mention and keeps the rest as text', () => {
    expect(kinds('@maya you were right')).toEqual(['mention:@maya', 'text: you were right']);
  });

  it('handles a mention mid-sentence and more than one', () => {
    expect(kinds('ask @maya or @dev_2 about it')).toEqual([
      'text:ask ', 'mention:@maya', 'text: or ', 'mention:@dev_2', 'text: about it',
    ]);
  });

  it('does NOT light up the domain half of an email', () => {
    expect(kinds('mail me at tyler@example')).toEqual(['text:mail me at tyler@example']);
  });

  it('ignores a bare @ with nothing after it', () => {
    expect(kinds('what @ even')).toEqual(['text:what @ even']);
  });

  it('stops the handle at punctuation so trailing periods stay text', () => {
    expect(kinds('thanks @maya!')).toEqual(['text:thanks ', 'mention:@maya', 'text:!']);
  });

  it('is lossless — segments concatenate back to the input', () => {
    for (const body of ['@a b @c', 'no mentions here', 'x@y @z', '@only', 'hi @maya, and @dev']) {
      expect(parseCommentSegments(body).map((s) => s.value).join('')).toBe(body);
    }
  });

  it('caps an absurdly long handle instead of swallowing the sentence', () => {
    const long = 'a'.repeat(40);
    const [first] = parseCommentSegments(`@${long}`);
    expect(first).toEqual({ type: 'mention', value: `@${'a'.repeat(30)}`, username: 'a'.repeat(30) });
  });
});

describe('replyDraftFor', () => {
  it('prefixes the handle and leaves a trailing space to type after', () => {
    expect(replyDraftFor('maya')).toBe('@maya ');
  });

  it('tolerates a handle that already carries its @', () => {
    expect(replyDraftFor('@maya')).toBe('@maya ');
  });

  it('returns empty for a missing handle rather than a bare @', () => {
    expect(replyDraftFor('')).toBe('');
    expect(replyDraftFor(null)).toBe('');
    expect(replyDraftFor(undefined)).toBe('');
  });

  it('refuses a handle that is not a username', () => {
    expect(replyDraftFor('not a handle')).toBe('');
  });
});
