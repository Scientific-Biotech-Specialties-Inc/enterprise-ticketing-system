import { useLayoutEffect } from 'react';

let lockCount = 0;
let originalBodyOverflow = '';

export default function useLockBodyScroll(active = true) {
  useLayoutEffect(() => {
    if (!active) return undefined;
    lockCount += 1;
    if (lockCount === 1) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.style.overflow = originalBodyOverflow || '';
      }
    };
  }, [active]);
}
