import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One-shot submit latch for modal save buttons.
 *
 * A bottom sheet stays tappable through its ~300ms exit animation, so a
 * double-tap on Save runs the handler twice — e.g. a second
 * `rateRestaurant({ isNewVisit: true })` archives the just-saved rating as
 * another visit (visit ids are minted per call). Call `tryLock()` at the
 * point of no return: it returns true exactly once per open; render the CTA
 * disabled off `submitting`. The latch re-arms whenever `open` flips back to
 * true; call `release()` to re-arm early (e.g. a failed save the user should
 * be able to retry).
 */
export function useSubmitOnce(open: boolean) {
  const lockedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      lockedRef.current = false;
      setSubmitting(false);
    }
  }, [open]);

  const tryLock = useCallback(() => {
    if (lockedRef.current) return false;
    lockedRef.current = true;
    setSubmitting(true);
    return true;
  }, []);

  const release = useCallback(() => {
    lockedRef.current = false;
    setSubmitting(false);
  }, []);

  return { submitting, tryLock, release };
}
