/* ── Frame extraction from a scrolling screen recording ─────────────────
   The Import page's video path: instead of taking a stack of screenshots,
   the user screen-records themselves scrolling through their list (Beli
   etc.) and uploads the recording. This module turns that video into what
   the screenshot path already consumes — a short sequence of still frames
   that together cover the whole list with modest overlap.

   How frames are chosen: the video is sampled by seeking every ~150ms.
   Each sample is fingerprinted from its MIDDLE BAND (the scrolling list
   area — the status bar and the app's fixed header/tab chrome at the top
   and bottom are excluded so static pixels can't anchor the estimate):
   a 64×256 luminance thumbnail plus its row-mean profile. The vertical
   scroll between consecutive samples is measured by sliding the two row
   profiles against each other (SSD over the overlap), and the ACCUMULATED
   scroll distance is what triggers keeping a frame — one keep per
   ~65% of a band's worth of new content. Tracking displacement instead of
   frame difference matters: a visually uniform list can scroll by exactly
   k rows and look almost unchanged to a whole-frame diff, silently
   skipping content. Holding still keeps nothing. Screen recordings are
   digital captures, so kept frames are always crisp — there is no
   motion blur to dodge.

   Kept frames come back as JPEG blobs already scaled to the tiler's
   1000px target width; `prepareScreenshotTiles` accepts them unchanged. */

/** Recording covers more list than one import can read — split it up. */
export class RecordingTooLongError extends Error {
  constructor() {
    super(
      'That recording covers a very long list. Record it in parts of about 30 seconds each and import them one at a time.',
    );
    this.name = 'RecordingTooLongError';
  }
}

const SAMPLE_STEP_S = 0.15;     // ~7 looks per second of video
const MAX_SAMPLES = 900;        // spreads thinner beyond ~2 minutes
const PROFILE_W = 64;           // fingerprint thumbnail size
const PROFILE_H = 256;
/** Fingerprint band: skip the status bar + app header (top) and the tab
 *  bar (bottom) so only the scrolling region drives the estimate. */
const BAND_TOP = 0.15;
const BAND_BOTTOM = 0.92;
/** Fraction of the band that must scroll past before keeping a frame.
 *  Consecutive kept frames overlap by the remainder, so a row cut at one
 *  frame's edge is whole in the next. */
const KEEP_SHIFT_FRACTION = 0.65;
/** Leftover scroll at the end of the video worth a final catch-up frame. */
const TAIL_KEEP_FRACTION = 0.12;
/** Profile rows that must overlap for a shift estimate to be trusted. */
const MIN_OVERLAP_ROWS = 64;
/** Best-alignment cost above this = the samples don't actually overlap
 *  (app switch, sheet opening) — treat the shift as unknown. */
const MAX_MATCH_COST = 900;
/** Mean abs. luminance diff (0–255) vs the last KEPT frame that reads as
 *  "substantially new content" regardless of what the shift tracking says.
 *  A safety net for aliased shift estimates, not the primary trigger —
 *  low values double the frame count by firing on half-scrolled screens. */
const APPEARANCE_MAD = 30;
/** Matches TILE_TARGET_WIDTH in import-restaurants-client. */
const TARGET_WIDTH = 1000;
export const MAX_RECORDING_FRAMES = 32;

/**
 * Vertical scroll (in profile rows) between two row-mean luminance
 * profiles, by sliding one against the other and taking the offset with
 * the lowest mean squared difference over the overlap. Positive = content
 * moved up (the user scrolled down). Returns null when even the best
 * alignment is a bad match — the frames don't share content.
 */
export function rowProfileShift(
  prev: Float32Array,
  cur: Float32Array,
  minOverlap = MIN_OVERLAP_ROWS,
): number | null {
  const H = Math.min(prev.length, cur.length);
  const maxShift = H - minOverlap;
  let bestDy = 0;
  let bestCost = Infinity;
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    // dy > 0: prev row (r + dy) lines up with cur row r.
    const from = Math.max(0, -dy);
    const to = Math.min(H, H - dy);
    let cost = 0;
    for (let r = from; r < to; r++) {
      const d = cur[r] - prev[r + dy];
      cost += d * d;
    }
    cost /= to - from;
    // Tiny bias toward small shifts so a flat, ambiguous profile (blank
    // screen) reads as "not moving" instead of wandering.
    cost += Math.abs(dy) * 0.02;
    if (cost < bestCost) {
      bestCost = cost;
      bestDy = dy;
    }
  }
  // A poor best match, or a best match pinned at the search boundary (a
  // fast fling can move more than the searchable range between samples —
  // the true shift may be clipped or aliased), both mean "don't trust it".
  if (bestCost > MAX_MATCH_COST || Math.abs(bestDy) >= maxShift - 2) return null;
  return bestDy;
}

/** Mean absolute difference between two same-length luminance buffers. */
export function meanAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

interface Fingerprint {
  rows: Float32Array;
  pixels: Uint8ClampedArray;
}

/**
 * Extract list-covering still frames from a screen recording. Resolves
 * with JPEG blobs (scaled to the tiler's width) in scroll order. Reports
 * progress through the video's duration as 0–1. Throws a friendly Error
 * when the file can't be decoded and RecordingTooLongError when the
 * recording covers more than MAX_RECORDING_FRAMES frames of list.
 */
export async function extractFramesFromRecording(
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<Blob[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Couldn't open that recording — it took too long to load.")),
        20000,
      );
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("Couldn't play that recording here. Export it as an MP4 or MOV video and try again."));
      };
      video.src = url;
    });

    // Some containers report Infinity/0 until forced to the end once.
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => resolve(), 4000);
        video.ondurationchange = () => {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            window.clearTimeout(timer);
            resolve();
          }
        };
        video.currentTime = Number.MAX_SAFE_INTEGER;
      });
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        throw new Error("Couldn't read that recording's length. Export it as an MP4 or MOV video and try again.");
      }
    }
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("That file doesn't seem to contain video. Pick the screen recording itself.");
    }

    const duration = video.duration;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Kept-frame canvas at the tiler's working width.
    const scale = Math.min(1, TARGET_WIDTH / vw);
    const fw = Math.max(1, Math.round(vw * scale));
    const fh = Math.max(1, Math.round(vh * scale));
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = fw;
    frameCanvas.height = fh;
    const fctx = frameCanvas.getContext('2d');

    // Fingerprint canvas over the scrolling band only.
    const bandTop = vh * BAND_TOP;
    const bandH = vh * (BAND_BOTTOM - BAND_TOP);
    const profileCanvas = document.createElement('canvas');
    profileCanvas.width = PROFILE_W;
    profileCanvas.height = PROFILE_H;
    const pctx = profileCanvas.getContext('2d', { willReadFrequently: true });
    if (!fctx || !pctx) throw new Error('Canvas unavailable');

    const fingerprint = (): Fingerprint => {
      pctx.drawImage(video, 0, bandTop, vw, bandH, 0, 0, PROFILE_W, PROFILE_H);
      const data = pctx.getImageData(0, 0, PROFILE_W, PROFILE_H).data;
      const pixels = new Uint8ClampedArray(PROFILE_W * PROFILE_H);
      const rows = new Float32Array(PROFILE_H);
      for (let r = 0; r < PROFILE_H; r++) {
        let sum = 0;
        for (let c = 0; c < PROFILE_W; c++) {
          const i = (r * PROFILE_W + c) * 4;
          const lum = (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10;
          pixels[r * PROFILE_W + c] = lum;
          sum += lum;
        }
        rows[r] = sum / PROFILE_W;
      }
      return { rows, pixels };
    };

    const frames: Blob[] = [];
    const keepFrame = async () => {
      fctx.drawImage(video, 0, 0, fw, fh);
      const blob = await new Promise<Blob | null>((res) => frameCanvas.toBlob(res, 'image/jpeg', 0.9));
      if (blob) frames.push(blob);
    };

    const seekTo = (t: number) =>
      new Promise<void>((resolve, reject) => {
        const target = Math.min(Math.max(t, 0.01), Math.max(0.01, duration - 0.01));
        if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) {
          resolve();
          return;
        }
        const timer = window.setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          reject(new Error('Reading the recording timed out. Try again, or use screenshots instead.'));
        }, 10000);
        const onSeeked = () => {
          window.clearTimeout(timer);
          resolve();
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = target;
      });

    const step = Math.max(SAMPLE_STEP_S, duration / MAX_SAMPLES);
    // Accumulated scroll (in band-profile rows) since the last kept frame.
    const keepThreshold = PROFILE_H * KEEP_SHIFT_FRACTION;
    let sinceKept = 0;
    let lastRows: Float32Array | null = null;
    let lastKeptPixels: Uint8ClampedArray | null = null;

    for (let t = 0; t < duration; t += step) {
      await seekTo(t);
      const fp = fingerprint();
      if (!lastRows) {
        await keepFrame();
        lastKeptPixels = fp.pixels;
      } else {
        const dy = rowProfileShift(lastRows, fp.rows);
        // Unknown shift (fast fling past the searchable range, transition,
        // detour into another screen): assume half a band moved so real
        // scrolling behind it still gets covered.
        sinceKept += dy === null ? PROFILE_H * 0.5 : Math.abs(dy);
        // Belt and braces: whatever the shift accounting says, a sample
        // that LOOKS this different from the last kept frame is showing
        // new content — an aliased shift estimate (uniform lists repeat)
        // must never let rows slip through the gap.
        const appearanceJump =
          lastKeptPixels !== null && meanAbsDiff(lastKeptPixels, fp.pixels) > APPEARANCE_MAD;
        if (sinceKept >= keepThreshold || appearanceJump) {
          if (frames.length >= MAX_RECORDING_FRAMES) throw new RecordingTooLongError();
          await keepFrame();
          lastKeptPixels = fp.pixels;
          sinceKept = 0;
        }
      }
      lastRows = fp.rows;
      onProgress?.(Math.min(1, t / duration));
    }

    // The scroll usually ends between keeps — catch the resting tail.
    if (sinceKept >= PROFILE_H * TAIL_KEEP_FRACTION && frames.length < MAX_RECORDING_FRAMES) {
      await keepFrame();
    }

    onProgress?.(1);
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    try { video.load(); } catch { /* ignore */ }
  }
}
