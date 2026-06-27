import React, { useEffect, useRef, useState } from 'react';
import MuxPlayer from '@mux/mux-player-react';
import type MuxPlayerElement from '@mux/mux-player';
import { cn } from '../lib/utils';

/**
 * Mux-backed reel video for the reels feed.
 *
 * Drop-in replacement for the legacy <video> when a reel has a Mux playback id.
 * Plays adaptive HLS via Mux Player (native HLS on iOS/Safari, hls.js on
 * Chromium — works inside the Capacitor WebView), with a Mux-generated poster
 * that paints instantly. Self-contained: it handles autoplay-on-active,
 * mute sync, and tap-to-pause itself, and reports paused state up so the
 * slide's shared paused overlay still works.
 *
 * Lazy: the player only mounts for the active slide and its near neighbours
 * (poster image otherwise), mirroring the windowing the <video> path used so
 * the feed doesn't spin up a player for every reel.
 */
interface MuxReelMediaProps {
  playbackId: string;
  poster?: string;
  /** This slide is the focused one — autoplay + audio target. */
  active: boolean;
  /** Within the preload window — mount the player (vs. just the poster). */
  near: boolean;
  muted: boolean;
  /** Phone = edge-to-edge cover; desktop = letterboxed contain. */
  phoneMode: boolean;
  /** Toggle handler shared with the slide (e.g. to flip a play/pause overlay). */
  onPausedChange?: (paused: boolean) => void;
}

export const MuxReelMedia: React.FC<MuxReelMediaProps> = ({
  playbackId, poster, active, near, muted, phoneMode, onPausedChange,
}) => {
  const ref = useRef<MuxPlayerElement | null>(null);
  // Once mounted, keep it mounted while near so swiping back is instant; the
  // parent already unmounts the whole slide when it leaves the window.
  const [mounted, setMounted] = useState(near);
  useEffect(() => { if (near) setMounted(true); }, [near]);

  // Autoplay when this slide is active; pause (parked on the current frame)
  // otherwise. Mirrors the legacy <video> active effect.
  useEffect(() => {
    const el = ref.current;
    if (!el || !mounted) return;
    if (active) {
      try { el.currentTime = 0; } catch { /* ignore */ }
      void el.play?.()?.catch?.(() => { /* autoplay may need a gesture */ });
    } else {
      el.pause?.();
    }
  }, [active, mounted]);

  // Keep the player's muted flag in sync without touching play/pause.
  useEffect(() => {
    const el = ref.current;
    if (el) el.muted = muted;
  }, [muted, mounted]);

  // Mirror play/pause into the slide so its centered paused overlay reflects
  // reality (system pauses, autoplay blocks, taps).
  useEffect(() => {
    const el = ref.current;
    if (!el) { onPausedChange?.(true); return; }
    const onPlay = () => onPausedChange?.(false);
    const onPause = () => onPausedChange?.(true);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    onPausedChange?.(!!el.paused);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
    };
  }, [mounted, onPausedChange]);

  const onTap = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play?.()?.catch?.(() => {});
    else el.pause?.();
  };

  return (
    <div className="absolute inset-0 bg-black" onClick={onTap}>
      {mounted ? (
        <MuxPlayer
          ref={ref}
          playbackId={playbackId}
          streamType="on-demand"
          // Let Mux Player autoplay (muted) once HLS is ready when this slide
          // mounts active — more reliable than calling play() before load. The
          // active effect above covers the became-active-after-mount case.
          autoPlay={active ? 'muted' : false}
          loop
          muted={muted}
          poster={poster}
          preload={active ? 'auto' : 'metadata'}
          nohotkeys
          // Hide all Mux Player chrome — the reel is a bare, tappable surface.
          style={{
            width: '100%',
            height: '100%',
            '--controls': 'none',
            '--media-object-fit': phoneMode ? 'cover' : 'contain',
          } as React.CSSProperties}
          className="absolute inset-0 w-full h-full"
        />
      ) : (
        poster && (
          <img
            src={poster}
            alt=""
            className={cn('absolute inset-0 w-full h-full', phoneMode ? 'object-cover' : 'object-contain')}
          />
        )
      )}
    </div>
  );
};
