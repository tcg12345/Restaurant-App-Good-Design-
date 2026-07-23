import { describe, it, expect } from 'vitest';
import { rowProfileShift, meanAbsDiff } from './video-frames';

/* Deterministic pseudo-random luminance rows — structured like a real
   list capture (varied values), reproducible across runs. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomProfile(len: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = Math.round(rand() * 255);
  return out;
}

/** cur = prev scrolled up by `dy` rows, with fresh content at the bottom. */
function scrolled(prev: Float32Array, dy: number, seed: number): Float32Array {
  const fresh = randomProfile(dy, seed);
  const out = new Float32Array(prev.length);
  out.set(prev.subarray(dy), 0);
  out.set(fresh, prev.length - dy);
  return out;
}

describe('rowProfileShift', () => {
  const prev = randomProfile(256, 42);

  it('finds zero shift for identical profiles', () => {
    expect(rowProfileShift(prev, prev)).toBe(0);
  });

  it('recovers a moderate downward scroll exactly', () => {
    expect(rowProfileShift(prev, scrolled(prev, 37, 7))).toBe(37);
  });

  it('recovers a large scroll (most of a screen)', () => {
    expect(rowProfileShift(prev, scrolled(prev, 160, 9))).toBe(160);
  });

  it('survives compression-like noise on top of the shift', () => {
    const cur = scrolled(prev, 52, 11);
    const rand = mulberry32(3);
    const noisy = cur.map((v) => Math.max(0, Math.min(255, v + (rand() - 0.5) * 12)));
    expect(rowProfileShift(prev, noisy)).toBe(52);
  });

  it('returns null for unrelated content (no overlap to align)', () => {
    expect(rowProfileShift(prev, randomProfile(256, 999))).toBeNull();
  });
});

describe('meanAbsDiff', () => {
  it('is zero for identical buffers and scales with difference', () => {
    const a = new Uint8ClampedArray([10, 20, 30, 40]);
    expect(meanAbsDiff(a, a)).toBe(0);
    const b = new Uint8ClampedArray([20, 10, 40, 30]);
    expect(meanAbsDiff(a, b)).toBe(10);
  });
});
