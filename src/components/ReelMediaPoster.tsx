import React from 'react';

/** Keep a real image above the player until its first playing frame. Native
 * video posters can disappear while WebKit is still initializing HLS. */
export function ReelMediaPoster({ src, ready, fit = 'cover' }: {
  src?: string; ready: boolean; fit?: 'cover' | 'contain';
}) {
  if (!src) return null;
  return <img src={src} alt="" draggable={false} decoding="async"
    className="reel-media-poster absolute inset-0 w-full h-full pointer-events-none"
    style={{ objectFit: fit, opacity: ready ? 0 : 1 }} />;
}
