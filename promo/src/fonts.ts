/**
 * Load the app's real font files (copied from ../public/fonts — the
 * exact woff2s the product ships): Fraunces variable (display),
 * Noto Serif (serif), Manrope (sans).
 */
import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

export const fontsReady = Promise.all([
  loadFont({
    family: 'Fraunces',
    url: staticFile('fraunces-normal-latin.woff2'),
    weight: '200 900',
    style: 'normal',
  }),
  loadFont({
    family: 'Fraunces',
    url: staticFile('fraunces-italic-latin.woff2'),
    weight: '200 900',
    style: 'italic',
  }),
  loadFont({
    family: 'Noto Serif',
    url: staticFile('noto-serif-normal-latin.woff2'),
    weight: '100 900',
    style: 'normal',
  }),
  loadFont({
    family: 'Noto Serif',
    url: staticFile('noto-serif-italic-latin.woff2'),
    weight: '100 900',
    style: 'italic',
  }),
  loadFont({
    family: 'Manrope',
    url: staticFile('manrope-normal-latin.woff2'),
    weight: '200 800',
    style: 'normal',
  }),
]);
