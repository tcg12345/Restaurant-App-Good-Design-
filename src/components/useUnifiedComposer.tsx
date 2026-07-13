/**
 * Unified "Post" entry — Instagram-style media-first creation.
 *
 * One button covers what used to be separate Post and Reel options: the
 * user picks their media first, and the flow routes itself —
 *
 *   exactly one video  → the reel editor, video already loaded
 *   anything else      → the post composer (photos, mixed media,
 *                        multiple videos, or caption-only)
 *
 * Both destinations share the same 60s per-video cap, so nothing the
 * picker accepts gets stranded by the routing.
 */
import React, { useCallback, useRef } from 'react';
import { usePosts } from '../contexts/PostsContext';
import { useReels } from '../contexts/ReelsContext';

/** True when this selection should continue as a reel. */
export function routesToReel(files: File[]): boolean {
  return files.length === 1 && files[0].type.startsWith('video/');
}

/** Route already-picked media into the right composer. */
export function useUnifiedComposer(): (files: File[], caption?: string) => void {
  const { openAddPostModal } = usePosts();
  const { openAddReelModal } = useReels();
  return useCallback((files: File[], caption = '') => {
    const media = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (routesToReel(media)) {
      openAddReelModal(undefined, media[0]);
    } else {
      openAddPostModal({ files: media, caption });
    }
  }, [openAddPostModal, openAddReelModal]);
}

/**
 * Picker-first variant for menu buttons: `openPicker()` opens the OS
 * file dialog immediately; the selection then routes via
 * `useUnifiedComposer`. Render `pickerInput` once near the trigger.
 */
export function useUnifiedCreatePicker(): { openPicker: () => void; pickerInput: React.ReactNode } {
  const openComposer = useUnifiedComposer();
  const inputRef = useRef<HTMLInputElement>(null);
  const openPicker = useCallback(() => inputRef.current?.click(), []);
  const pickerInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.3gp,.qt,.hevc"
      multiple
      className="hidden"
      onChange={(e) => {
        // Manual copy — this project's TS lib types Array.from(FileList)
        // as unknown[], so an index loop keeps the File[] type intact.
        const list = e.target.files;
        const files: File[] = [];
        if (list) {
          for (let i = 0; i < list.length; i++) {
            const f = list.item(i);
            if (f) files.push(f);
          }
        }
        e.target.value = '';
        if (files.length > 0) openComposer(files);
      }}
    />
  );
  return { openPicker, pickerInput };
}
