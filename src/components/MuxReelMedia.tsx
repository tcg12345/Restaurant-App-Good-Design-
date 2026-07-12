import React, { useEffect, useRef, useState } from 'react';
import MuxPlayer from '@mux/mux-player-react';
import type MuxPlayerElement from '@mux/mux-player';
import { cn } from '../lib/utils';
/**
 * What the page-level scrub bar needs from the active reel's media. Works for
 * both a legacy <video> and a Mux player (both expose this media subset).
 */
export interface ActiveReelMedia {
  el: Pick<HTMLMediaElement, 'currentTime' | 'duration' | 'paused' | 'play' | 'pause'>;
  /** Plain video src for the legacy seek-preview popover (omitted for Mux). */
  previewSrc?: string;
  /** Mux: scrub the main (already-buffered) video live as the user drags, so
   *  the full-screen reel updates frame-by-frame instead of a coarse preview. */
  liveScrub?: boolean;
  /** Mux: the underlying decoded <video> — seeked directly (reliable on iOS)
   *  and mirrored into the preview-box canvas for a smooth, many-fps preview. */
  frameSource?: () => HTMLVideoElement | null;
}

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
  /** Override the object-fit (posts always letterbox with 'contain'). */
  objectFit?: 'cover' | 'contain';
  /** Toggle handler shared with the slide (e.g. to flip a play/pause overlay). */
  onPausedChange?: (paused: boolean) => void;
  /** Fires on a user tap that toggles playback, with the state the tap
   *  produced — lets the slide flash its play/pause animation. Distinct
   *  from onPausedChange, which also fires for system pauses/autoplay. */
  onUserToggle?: (nowPaused: boolean) => void;
  /** Publish this player to the page scrub bar when active, null when not. */
  onActiveMedia?: (media: ActiveReelMedia | null) => void;
}

export const MuxReelMedia: React.FC<MuxReelMediaProps> = ({
  playbackId, poster, active, near, muted, phoneMode, objectFit, onPausedChange, onUserToggle, onActiveMedia,
}) => {
  const fit = objectFit ?? (phoneMode ? 'cover' : 'contain');
  const ref = useRef<MuxPlayerElement | null>(null);
  // Mount while near so swiping is instant, and UNMOUNT once the slide
  // leaves the near-window. (The parent does NOT unmount off-screen slides,
  // so a one-way latch here accumulated a live <mux-player> for every reel
  // ever scrolled past — memory / media-decoder exhaustion on iPhone.)
  const [mounted, setMounted] = useState(near);
  useEffect(() => { setMounted(near); }, [near]);

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

  // Publish this player to the page scrub bar while it's the active slide, with
  // a Mux image-thumbnail function for the scrub-preview popover. Mirrors the
  // legacy <video> publish in ReelSlide.
  useEffect(() => {
    const el = ref.current;
    if (!onActiveMedia) return;
    if (active && el && mounted) {
      onActiveMedia({
        el,
        liveScrub: true,
        // Mux Player keeps the decoded native <video> at .media.nativeEl.
        frameSource: () => (el as unknown as { media?: { nativeEl?: HTMLVideoElement } }).media?.nativeEl ?? null,
      });
    }
    return () => { if (active) onActiveMedia(null); };
  }, [active, mounted, onActiveMedia]);

  const onTap = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      onUserToggle?.(false);
      void el.play?.()?.catch?.(() => {});
    } else {
      onUserToggle?.(true);
      el.pause?.();
    }
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
            '--media-object-fit': fit,
          } as React.CSSProperties}
          className="absolute inset-0 w-full h-full"
        />
      ) : (
        poster && (
          <img
            src={poster}
            alt=""
            className={cn('absolute inset-0 w-full h-full', fit === 'cover' ? 'object-cover' : 'object-contain')}
          />
        )
      )}
    </div>
  );
};
