/**
 * Generates every raster form of the GoodEats mark from one geometry
 * definition: web icons, the maskable PWA icon, the OG card, the iOS app
 * icon, and the light/dark launch images.
 *
 * Written against zlib and nothing else. The repo has no image toolchain
 * (no sharp, no librsvg, no ImageMagick), and adding one so a logo can be
 * resized would be a heavy dependency for a job this small — the mark is a
 * disc, a rounded bar and one quadratic curve, which is a short rasteriser.
 * Keeping it here also means the icons can never drift from the component:
 * MARK below is the same 100x100 geometry as src/components/Logo.tsx and
 * public/logo.svg.
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ── Brand ─────────────────────────────────────────────────────────────── */
// Graphite and bone: the brand is the two tones of the logo, and each
// theme's accent is the other one. Light-theme assets are the graphite
// mark ground with a white bowl (the app icon); dark-theme assets invert.
const INK = [0x1c, 0x1a, 0x19];        // --color-primary, light
const BONE = [0xf2, 0xef, 0xe9];       // --color-primary, dark
const WHITE = [0xff, 0xff, 0xff];
const CREAM = [0xff, 0xff, 0xff];      // --color-surface, light
const GRAPHITE = [0x1e, 0x1e, 0x20];   // --color-surface, dark
const DARK_BOWL = [0x1a, 0x19, 0x18];  // --color-on-primary, dark

/* ── Geometry, on the same 100x100 viewBox as Logo.tsx ─────────────────── */
const DISC = { cx: 50, cy: 50, r: 48 };
const RIM = { x: 23, y: 40, w: 54, h: 6.5, r: 3.25 };
// "M28 52 Q50 75 72 52 Z" flattened to a polygon.
const BOWL = (() => {
  const [p0, c, p1] = [[28, 52], [50, 75], [72, 52]];
  const pts = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    pts.push([
      u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
      u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
    ]);
  }
  return pts; // closing edge p1->p0 is implicit
})();

const inDisc = (x, y) => (x - DISC.cx) ** 2 + (y - DISC.cy) ** 2 <= DISC.r ** 2;

function inRoundRect(x, y, { x: rx, y: ry, w, h, r }) {
  if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
  // Clamp to the inner box; outside it, the corner radius decides.
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The vessel sits a shade under the rim (Logo.tsx draws it at 82%). */
const shade = (c, ground, a = 0.82) => c.map((v, i) => Math.round(v * a + ground[i] * (1 - a)));

/**
 * Colour at a point in viewBox space, or null for transparent.
 * `ground` is the disc colour and `on` the bowl's; `disc: false` draws the
 * bowl in `ground` on whatever the caller already painted.
 */
function markAt(x, y, { disc = true, bg = null, ground = INK, on = WHITE } = {}) {
  const onRim = inRoundRect(x, y, RIM);
  const onVessel = !onRim && inPolygon(x, y, BOWL);
  if (disc) {
    if (!inDisc(x, y)) return bg;
    return onRim ? on : onVessel ? shade(on, ground) : ground;
  }
  return onRim || onVessel ? ground : bg;
}

/* ── Rasteriser ────────────────────────────────────────────────────────── */
/**
 * @param size    output px (square unless `height` given)
 * @param scale   viewBox units covered across the output — 100 fills the
 *                frame edge to edge, larger values inset the mark.
 */
function raster({ size, height = size, draw }) {
  const w = size, h = height;
  const px = Buffer.alloc(w * h * 4);
  const SS = 3; // 3x3 supersample — enough for a disc and one curve
  for (let py = 0; py < h; py++) {
    for (let pxi = 0; pxi < w; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = draw((pxi + (sx + 0.5) / SS), (py + (sy + 0.5) / SS), w, h);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (py * w + pxi) * 4;
      if (a > 0) {
        // Average over COVERED samples so edge pixels keep full colour and
        // vary only in alpha; averaging over all n would darken edges
        // toward black on a transparent ground.
        const cov = a / 255;
        px[i] = Math.round(r / cov);
        px[i + 1] = Math.round(g / cov);
        px[i + 2] = Math.round(b / cov);
        px[i + 3] = Math.round(a / n);
      }
    }
  }
  return { w, h, px };
}

/* ── PNG encoder ───────────────────────────────────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG({ w, h, px }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(relPath, image) {
  const out = resolve(ROOT, relPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePNG(image));
  console.log(`  ${relPath}  ${image.w}x${image.h}`);
}

/* ── Draw helpers ──────────────────────────────────────────────────────── */
/** Mark filling the frame (the disc IS the icon shape). */
const fullBleedDisc = (inset = 0, tones = {}) => (x, y, w, h) => {
  const span = 100 + inset * 2;
  return markAt((x / w) * span - inset, (y / h) * span - inset, tones);
};

/** Opaque square of `bg` with the mark's disc centred at `frac` of the frame. */
const centred = (bg, frac, tones = {}) => (x, y, w, h) => {
  const side = Math.min(w, h) * frac;
  const vx = ((x - (w - side) / 2) / side) * 100;
  const vy = ((y - (h - side) / 2) / side) * 100;
  if (vx < 0 || vx > 100 || vy < 0 || vy > 100) return bg;
  return markAt(vx, vy, { bg, ...tones });
};

console.log('GoodEats icons →');

/* Web + PWA */
write('public/icon-192.png', raster({ size: 192, draw: fullBleedDisc() }));
write('public/icon-512.png', raster({ size: 512, draw: fullBleedDisc() }));
/* The platform icons are the BOWL on a solid graphite field, not a disc
   floating on one: iOS and Android both apply their own mask (squircle,
   circle, whatever a launcher decides), so the icon has to paint to the
   edge or it gets a ring of dead space inside the mask. `frac` slightly
   over 1 lets the disc overshoot the frame — invisible, since it is the
   same colour as the ground, and it keeps the bowl at ~54% of the width,
   which is the proportion Apple's own icons sit at. */
const PLATFORM_ICON = centred(INK, 1.02);

// Maskable: the bowl sits well inside the 80% safe circle at this scale,
// and the terracotta ground fills the corners a launcher may crop.
write('public/icon-maskable-512.png', raster({ size: 512, draw: PLATFORM_ICON }));
// apple-touch-icon must be opaque — iOS composites it on black otherwise.
write('public/apple-touch-icon.png', raster({ size: 180, draw: PLATFORM_ICON }));

/* Social card: here the disc IS the subject, small on the page ground. */
write('public/og-image.png', raster({ size: 1200, height: 630, draw: centred(CREAM, 0.42) }));

/* iOS: full-bleed square, no alpha — the system applies the corner mask. */
write('ios-assets/AppIcon-512@2x.png', raster({ size: 1024, draw: PLATFORM_ICON }));

/* iOS launch images. Small on purpose: the storyboard aspect-FILLS this
   square into a tall screen, so roughly the middle 45% of the width is all
   that survives on a phone — anything sized for the square reads as a
   billboard on the device. */
for (const n of ['', '-1', '-2']) {
  write(`ios-assets/splash-2732x2732${n}.png`, raster({ size: 2732, draw: centred(CREAM, 0.11) }));
  // Dark launch: the brand's other face — a bone disc with a graphite bowl.
  write(`ios-assets/splash-2732x2732-dark${n}.png`, raster({ size: 2732, draw: centred(GRAPHITE, 0.11, { ground: BONE, on: DARK_BOWL }) }));
}

console.log('done.');
