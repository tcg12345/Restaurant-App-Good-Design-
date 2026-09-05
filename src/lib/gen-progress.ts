/**
 * Progress for a streamed AI generation.
 *
 * The model streams the tool JSON token by token, so the honest signal of
 * "how far along" is characters received so far against how many this
 * kind of request usually produces. Nobody knows the final length in
 * advance — so the expectation is LEARNED: every finished generation
 * updates a per-kind moving average of size and duration (persisted, so
 * the second recipe you ever build already has a calibrated bar).
 *
 * Before the first byte lands (Opus can think for several seconds) the
 * only signal is time, so the bar creeps on the time model, capped low.
 * It never reaches 100% on its own: the caller snaps it there when the
 * response actually completes, so a longer-than-usual recipe stalls at
 * 96% instead of lying and finishing early.
 */

export type GenKind = 'recipe' | 'ideas' | 'combine' | 'photo';

export interface GenExpectation {
  /** Characters of tool JSON a typical response carries. */
  chars: number;
  /** Wall-clock milliseconds a typical response takes. */
  ms: number;
}

const DEFAULTS: Record<GenKind, GenExpectation> = {
  recipe: { chars: 9000, ms: 32000 },
  ideas: { chars: 1800, ms: 7000 },
  combine: { chars: 9000, ms: 34000 },
  // Opus reading one image runs a few seconds longer than a text create.
  photo: { chars: 9000, ms: 36000 },
};

const STORAGE_KEY = 'goodeats-ai-gen-stats';
/** The bar's ceiling until the response really finishes. */
export const PROGRESS_CEILING = 0.96;

type Stats = Partial<Record<GenKind, GenExpectation>>;

function readStats(): Stats {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Stats) : {};
  } catch {
    return {};
  }
}

function writeStats(stats: Stats) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    /* storage full or blocked — the defaults still work */
  }
}

function sane(e: unknown): e is GenExpectation {
  if (!e || typeof e !== 'object') return false;
  const { chars, ms } = e as GenExpectation;
  return Number.isFinite(chars) && chars >= 200 && chars <= 60000
    && Number.isFinite(ms) && ms >= 1000 && ms <= 180000;
}

/** What to expect from a generation of this kind — learned if we've seen
 *  one before, a sensible default otherwise. */
export function loadExpectation(kind: GenKind): GenExpectation {
  const saved = readStats()[kind];
  return sane(saved) ? saved : DEFAULTS[kind];
}

/** Fold a finished generation into the expectation. Half-weight moving
 *  average: quick to adapt after a model or prompt change, but one
 *  outlier (a 24-step laminated dough) doesn't hijack the bar for the
 *  next simple pasta. Values outside the sane range are ignored. */
export function recordGeneration(kind: GenKind, actual: GenExpectation): GenExpectation {
  if (!sane(actual)) return loadExpectation(kind);
  const stats = readStats();
  const prev = stats[kind];
  const next: GenExpectation = sane(prev)
    ? { chars: Math.round(prev.chars * 0.5 + actual.chars * 0.5), ms: Math.round(prev.ms * 0.5 + actual.ms * 0.5) }
    : { chars: Math.round(actual.chars), ms: Math.round(actual.ms) };
  writeStats({ ...stats, [kind]: next });
  return next;
}

export interface ProgressInput {
  elapsedMs: number;
  /** Characters of tool JSON received so far. */
  chars: number;
  expected: GenExpectation;
}

/** 0 … PROGRESS_CEILING. Characters lead once they exist; time is the
 *  fallback while the model is still thinking, and a floor after that so
 *  a slow trickle still shows life. */
export function estimateProgress({ elapsedMs, chars, expected }: ProgressInput): number {
  const byTime = Math.max(0, elapsedMs) / expected.ms;
  if (chars <= 0) {
    // Thinking. Creep, but never past a quarter: a bar that says "60%"
    // with nothing received yet is the lie this whole module exists to avoid.
    return Math.min(0.25, byTime * 0.6);
  }
  const byChars = chars / expected.chars;
  const p = Math.max(byChars, Math.min(byTime, 0.5));
  return Math.min(PROGRESS_CEILING, p);
}

/** Milliseconds still to go, projected from the observed streaming rate
 *  (or the time model before anything has streamed). Null while it's too
 *  early to say anything useful. */
export function estimateRemainingMs({ elapsedMs, chars, expected }: ProgressInput): number | null {
  if (elapsedMs < 1500) return null;
  if (chars <= 0) return Math.max(0, expected.ms - elapsedMs);
  const fraction = Math.min(PROGRESS_CEILING, Math.max(chars / expected.chars, 0.02));
  const projectedTotal = elapsedMs / fraction;
  return Math.max(0, Math.round(projectedTotal - elapsedMs));
}

/** "About 12s left" / "Almost there" — the label under the bar. */
export function formatRemaining(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 2000) return 'Almost there';
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `About ${Math.ceil(s / 60)} min left` : `About ${s}s left`;
}
