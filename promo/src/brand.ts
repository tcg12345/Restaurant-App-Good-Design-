/**
 * Gourmet Canvas brand tokens — extracted verbatim from the app:
 *   src/index.css @theme + --ob-* onboarding tokens,
 *   src/pages/LocationPage.css :root editorial tokens,
 *   src/lib/score.ts score bands.
 * Do not invent values here; every color/font traces to app code.
 */

export const COLORS = {
  // Core theme (src/index.css @theme)
  surface: '#ffffff',
  onSurface: '#1e1b1a',
  primary: '#9f3012',        // --color-primary / --color-clay
  secondary: '#5c6144',      // --color-secondary / --color-olive
  accent: '#d4a373',         // --color-accent (warm tan)
  muted: '#f1f1f1',
  ink: '#1e1b1a',
  ink2: '#3d3835',
  ink3: '#6b6359',
  ink4: '#a19a8e',
  line: '#eaeaea',
  line2: '#dcdcdc',
  persimmon: '#e85a2c',

  // Onboarding / marketing palette (--ob-* tokens)
  obBg: '#fbf4f0',
  obInk: '#211c19',
  obSecondary: '#7a716b',
  obLabel: '#a99e97',
  obBorder: '#ece1da',
  obTerra: '#a6371d',
  obTerraHover: '#8c2e18',
  obPillBg: '#f1e8e2',
  obDivider: '#eadfd8',
  obBadgeBg: '#f4e3dc',
  obSuccess: '#1b8a5e',

  // Editorial tokens (LocationPage.css :root)
  edInk: '#1C1816',
  edInk2: '#4A423C',
  edMuted: '#8C8278',
  edMuted2: '#B8AFA4',
  edAccent: '#A8392A',
  edAccentSoft: '#F3E0D7',
  edGreen: '#2E7D5C',
  edGreenSoft: '#DCEEDE',
  surface2: '#F7F7F7',

  // Score bands (src/lib/score.ts: >=8 green, >=5 yellow, else red —
  // tailwind green-600 / yellow-600 / red-500)
  scoreGreen: '#16a34a',
  scoreYellow: '#ca8a04',
  scoreRed: '#ef4444',
  scoreGreenBg: '#f0fdf4',   // green-50
  scoreGreenBorder: '#bbf7d0', // green-200
} as const;

export const FONTS = {
  display: 'Fraunces, "Noto Serif", serif',   // --font-display
  serif: '"Noto Serif", serif',                // --font-serif
  sans: 'Manrope, sans-serif',                 // --font-sans
} as const;

/** Score → band color, mirroring src/lib/score.ts. */
export const scoreColor = (s: number): string =>
  s >= 8 ? COLORS.scoreGreen : s >= 5 ? COLORS.scoreYellow : COLORS.scoreRed;

export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 615, // 20.5s
} as const;
