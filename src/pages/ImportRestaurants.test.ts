import { describe, it, expect } from 'vitest';
import { tokenizeCSV } from './ImportRestaurants';

describe('tokenizeCSV', () => {
  it('parses plain rows and trims blank lines', () => {
    expect(tokenizeCSV('a,b,c\n1,2,3\n\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(tokenizeCSV('name,address\nNobu,"195 Broadway, New York"')).toEqual([
      ['name', 'address'],
      ['Nobu', '195 Broadway, New York'],
    ]);
  });

  it('handles embedded newlines inside quoted fields', () => {
    // The old line-splitting parser corrupted every row after this one.
    const text = 'name,notes\nNobu,"line one\nline two"\nCarbone,fine';
    expect(tokenizeCSV(text)).toEqual([
      ['name', 'notes'],
      ['Nobu', 'line one\nline two'],
      ['Carbone', 'fine'],
    ]);
  });

  it('unescapes "" doubled quotes', () => {
    expect(tokenizeCSV('name,notes\nNobu,"they said ""wow"""')).toEqual([
      ['name', 'notes'],
      ['Nobu', 'they said "wow"'],
    ]);
  });

  it('handles CRLF line endings and no trailing newline', () => {
    expect(tokenizeCSV('a,b\r\n1,2\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });
});
