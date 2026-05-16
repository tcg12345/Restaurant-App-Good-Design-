/**
 * Typed JS bridge for the PhotoLibrary native plugin (see
 * ios/App/App/PhotosPlugin.swift). All calls fall through to a no-op
 * implementation on the web so calling code doesn't have to branch.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';

export type PhotoPermissionStatus =
  | 'notDetermined'
  | 'restricted'
  | 'denied'
  | 'authorized'
  | 'limited';

export type MediaTypeFilter = 'all' | 'photo' | 'video';

export interface MediaItem {
  /** Stable PHAsset local identifier — pass back to `getMedia` to fetch the
   *  full file. */
  id: string;
  type: 'photo' | 'video';
  width: number;
  height: number;
  /** Unix ms; 0 if the asset has no creation date. */
  creationDate: number;
  /** JPEG data URL, ~240 px on the long side. */
  thumbnailDataUrl?: string;
  /** Videos only. */
  durationSeconds?: number;
}

export interface ListMediaOptions {
  mediaType?: MediaTypeFilter;
  limit?: number;
  offset?: number;
  thumbnailSize?: number;
}

export interface ListMediaResult {
  items: MediaItem[];
  total: number;
}

export interface GetMediaResult {
  /** `file://...` URL of a temporary copy of the asset. Safe to pass into
   *  `<video src>` / `<img src>` or fetch() to read as a Blob for upload. */
  path: string;
  mimeType: string;
}

interface PhotoLibraryPlugin {
  checkPermission(): Promise<{ status: PhotoPermissionStatus }>;
  requestPermission(): Promise<{ status: PhotoPermissionStatus }>;
  listMedia(options: ListMediaOptions): Promise<ListMediaResult>;
  getMedia(options: { id: string }): Promise<GetMediaResult>;
  openSettings(): Promise<{ opened: boolean }>;
}

const PhotoLibrary = registerPlugin<PhotoLibraryPlugin>('PhotoLibrary', {
  // Web fallback so dev/preview builds don't throw if the React UI happens
  // to mount there. All methods reject so the caller can fall back to a
  // standard <input type="file"> picker.
  web: {
    async checkPermission() {
      return { status: 'denied' as const };
    },
    async requestPermission() {
      return { status: 'denied' as const };
    },
    async listMedia() {
      throw new Error('PhotoLibrary is only available on native iOS.');
    },
    async getMedia() {
      throw new Error('PhotoLibrary is only available on native iOS.');
    },
    async openSettings() {
      return { opened: false };
    },
  },
});

export { PhotoLibrary };

/** True only on a native shell where the PhotoLibrary plugin can actually
 *  enumerate the camera roll. Use to decide whether to render the inline
 *  grid (native) or the existing `<input type="file">` picker (web). */
export function canUseNativePhotoLibrary(): boolean {
  return Capacitor.isNativePlatform();
}

/** Convert a `file://...` path returned by `getMedia` into a Blob the rest
 *  of the upload pipeline can consume. */
export async function nativePathToFile(
  path: string,
  filename: string,
  mimeType: string,
): Promise<File> {
  // WebKit blocks fetch() against raw file:// URLs ("Cross origin requests
  // are only supported for HTTP"). Capacitor.convertFileSrc rewrites the
  // path to capacitor://localhost/_capacitor_file_/... which the WebView
  // is allowed to load.
  const url = Capacitor.convertFileSrc(path);
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], filename, { type: mimeType });
}
