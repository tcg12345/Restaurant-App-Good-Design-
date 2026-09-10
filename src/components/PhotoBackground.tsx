import React, { forwardRef } from 'react';
import { usePhotoUrl } from '../lib/usePhotoUrl';
/** Existing background gradients/layout stay intact while the photo is signed. */
export const PhotoBackground = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function PhotoBackground({style, ...props}, ref) {
  const background = style?.backgroundImage || '';
  const match = /url\((?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^)]*))\)/.exec(background);
  let source = match?.[1] ?? match?.[2] ?? match?.[3];
  if (match?.[1]) { try { source = JSON.parse(`"${match[1]}"`); } catch { source = undefined; } }
  const photo = usePhotoUrl(source);
  const resolved = match && photo.managed
    ? background.replace(match[0], photo.url ? `url(${JSON.stringify(photo.url)})` : 'none')
    : background;
  return <div {...props} ref={ref} style={{...style, backgroundImage:resolved}} />;
});
