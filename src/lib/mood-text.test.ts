import { describe, it, expect } from 'vitest';
import { parseMoodText, moodHasSignal } from './mood-text';
import { ALL_TAGS } from '../components/RatingShared';

describe('parseMoodText', () => {
  it('sends the cuisine to the SEARCH as well as the filter', () => {
    // "expensive sushi" returned nothing when the cuisine went only to a
    // hard filter: Google types most sushi rooms as Japanese, so the label
    // never matched and the price chips finished the job.
    const q = parseMoodText('expensive sushi');
    expect(q.cuisines).toEqual(['Sushi']);
    expect(q.searchPhrases).toEqual(expect.arrayContaining(['upscale', 'sushi']));
    expect(q.priceLevels).toEqual([3, 4]);
  });

  it('emits Google search phrases, because tags only cover rated places', () => {
    const q = parseMoodText('quiet romantic spot with a view');
    expect(q.searchPhrases).toEqual(expect.arrayContaining(['quiet', 'romantic', 'with a view']));
  });

  it('returns nothing for empty or unrecognized text, and claims nothing', () => {
    expect(moodHasSignal(parseMoodText(''))).toBe(false);
    const q = parseMoodText('somewhere my uncle would approve of');
    expect(moodHasSignal(q)).toBe(false);
    expect(q.recognized).toEqual([]);
  });

  it('reads a real mood sentence onto the engine levers', () => {
    const q = parseMoodText('Quiet date-night spot with great cocktails, not too pricey');
    expect(q.tags).toEqual(expect.arrayContaining(['Quiet & Peaceful', 'Romantic', 'Intimate', 'Great Cocktails']));
    expect(q.priceLevels).toEqual([1, 2]);
    expect(q.openNow).toBe(false);
  });

  it('consumes longest phrases first — "date night" never fires Late Night', () => {
    const q = parseMoodText('date night');
    expect(q.tags).toContain('Romantic');
    expect(q.tags).not.toContain('Late Night');
  });

  it('negated price beats the bare word', () => {
    expect(parseMoodText('not too expensive').priceLevels).toEqual([1, 2]);
    expect(parseMoodText('expensive').priceLevels).toEqual([3, 4]);
    expect(parseMoodText('nothing fancy').priceLevels).toEqual([1, 2]);
    expect(parseMoodText('fancy').priceLevels).toEqual([3, 4]);
  });

  it('maps cuisines through aliases to canonical labels', () => {
    expect(parseMoodText('craving tacos').cuisines).toEqual(['Taco']);
    expect(parseMoodText('pasta or sushi tonight').cuisines).toEqual(['Italian', 'Sushi']);
    expect(parseMoodText('korean bbq').cuisines).toEqual(expect.arrayContaining(['Korean', 'BBQ']));
  });

  it('understands practicalities', () => {
    const q = parseMoodText('somewhere still open for a quick bite with the kids');
    expect(q.openNow).toBe(true);
    expect(q.tags).toEqual(expect.arrayContaining(['Quick Bite', 'Kid Friendly']));
  });

  it('echoes what it understood, in the order it was said', () => {
    const q = parseMoodText('romantic rooftop, great wine, splurge');
    expect(q.recognized[0]).toMatch(/Romantic/);
    expect(q.recognized).toContain('Rooftop');
    expect(q.recognized).toContain('Great Wine List');
    expect(q.recognized).toContain('A splurge');
  });

  it('is punctuation- and case-insensitive', () => {
    const q = parseMoodText('COZY!! Al-Fresco... (cheap)');
    expect(q.tags).toEqual(expect.arrayContaining(['Cozy Atmosphere', 'Outdoor Seating', 'Good Value']));
    expect(q.priceLevels).toEqual([1, 2]);
  });

  it('only emits tags the rating vocabulary actually has', () => {
    // The invariant every prior table states: an invented token boosts a
    // tag no rater has ever applied. Sweep the whole phrase table through
    // realistic input and check every produced tag is canonical.
    const everything = parseMoodText(
      'quiet romantic cozy charming trendy casual chill upscale fancy rooftop view outdoor '
      + 'cocktails wine coffee dessert brunch vegetarian vegan healthy creative quick '
      + 'open late big group family solo cheap splurge celebrating anniversary birthday '
      + 'lively date night dog friendly',
    );
    for (const t of everything.tags) {
      expect(ALL_TAGS).toContain(t);
    }
    expect(everything.tags.length).toBeGreaterThan(10);
  });
});
