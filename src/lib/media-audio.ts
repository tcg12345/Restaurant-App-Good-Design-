// Audio helpers for the client-side video re-encoders (MediaEditor's
// applyVideoEdits, media-compress's encodeDownscaled).
//
// Both encoders play the source through a <canvas> and record
// canvas.captureStream() with a MediaRecorder. A canvas stream has NO audio —
// so unless we ALSO pull the source element's audio track in and merge it,
// every edited/compressed video uploads permanently silent. We capture the
// element's audio via HTMLMediaElement.captureStream() (unaffected by the
// element's `muted` flag, which only gates local speaker output) and merge it
// with the canvas video track.
//
// On engines without HTMLMediaElement.captureStream (notably older iOS
// WKWebView) we can't recover the audio; the caller detects that and warns the
// user instead of silently dropping sound.

// MediaRecorder mime candidates, AAC/Opus-audio variants first so the recorder
// actually muxes an audio track. h264+aac plays everywhere (and is the only
// combo iOS WKWebView records); Opus rides in WebM on Chromium.
export const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=h264,aac',
  'video/mp4;codecs=avc1.4d002a,mp4a.40.2',
  'video/mp4;codecs=h264',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** First supported mime from VIDEO_MIME_CANDIDATES, or null. */
export function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return VIDEO_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export interface SourceAudio {
  /** The source element's audio tracks (empty when none / not capturable). */
  tracks: MediaStreamTrack[];
  /** True when the element exposes no captureStream at all, so audio can't be
   *  recovered on this engine even if the source has sound. */
  captureUnavailable: boolean;
  /** Stop the capture stream we opened. Call AFTER the recorder has stopped. */
  cleanup: () => void;
}

/**
 * Pull the audio tracks out of a media element via captureStream(). Safe to
 * call once metadata has loaded. Never throws.
 */
export function captureSourceAudio(el: HTMLMediaElement): SourceAudio {
  const withCapture = el as HTMLMediaElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const capture = withCapture.captureStream?.bind(withCapture)
    ?? withCapture.mozCaptureStream?.bind(withCapture);
  if (!capture) return { tracks: [], captureUnavailable: true, cleanup: () => {} };
  try {
    const stream = capture();
    return {
      tracks: stream.getAudioTracks(),
      captureUnavailable: false,
      cleanup: () => { try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } },
    };
  } catch {
    return { tracks: [], captureUnavailable: true, cleanup: () => {} };
  }
}

/**
 * Best-effort: did the element actually decode audio? Reliable only AFTER
 * playback has run (webkitAudioDecodedByteCount counts decoded bytes). Returns
 * null when the engine exposes no usable signal.
 */
export function sourceHadAudio(el: HTMLMediaElement): boolean | null {
  const probe = el as HTMLMediaElement & {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length: number };
  };
  if (typeof probe.mozHasAudio === 'boolean') return probe.mozHasAudio;
  if (typeof probe.webkitAudioDecodedByteCount === 'number') return probe.webkitAudioDecodedByteCount > 0;
  if (probe.audioTracks && typeof probe.audioTracks.length === 'number') return probe.audioTracks.length > 0;
  return null;
}

/**
 * Merge a canvas video stream with the source element's audio into one stream
 * for MediaRecorder. Returns the combined stream plus whether audio was
 * actually attached.
 */
export function mergeCanvasAndAudio(
  canvasStream: MediaStream,
  audioTracks: MediaStreamTrack[],
): { stream: MediaStream; audioAttached: boolean } {
  if (audioTracks.length === 0) return { stream: canvasStream, audioAttached: false };
  const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
  return { stream: combined, audioAttached: true };
}
