import React, { forwardRef, useEffect, useRef } from 'react';
import { usePhotoUrl } from '../lib/usePhotoUrl';
export const PHOTO_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
/** Renders the same img element/classes/ref, signing only owned-project photos. */
export const PhotoImage = forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(function PhotoImage({src, onLoad, onError, ...props}, ref) {
  const photo = usePhotoUrl(src);
  const retried = useRef(false);
  useEffect(() => { retried.current = false; }, [src]);
  return <img {...props} ref={ref} src={photo.url || (photo.managed ? (photo.pending ? PHOTO_PLACEHOLDER : 'data:,') : undefined)}
    onLoad={event => { if (!photo.pending && photo.url) onLoad?.(event); }}
    onError={event => {
      if (photo.managed && !retried.current) { retried.current = true; photo.retry(); return; }
      onError?.(event);
    }} />;
});
