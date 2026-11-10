import { useLayoutEffect } from 'react';

let lockCount = 0;
let savedScrollY = 0;
let originalBodyOverflow = '';
let originalHtmlOverflow = '';
let originalBodyOverscroll = '';
let originalHtmlOverscroll = '';
let originalBodyPosition = '';
let originalBodyTop = '';
let originalBodyLeft = '';
let originalBodyRight = '';
let originalBodyWidth = '';
let originalBodyPaddingRight = '';

export default function useLockBodyScroll(active = true) {
  useLayoutEffect(() => {
    if (!active) return undefined;
    lockCount += 1;
    if (lockCount === 1) {
      savedScrollY =
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        0;

      const scrollbarWidth = Math.max(
        0,
        window.innerWidth - document.documentElement.clientWidth
      );

      originalBodyOverflow = document.body.style.overflow;
      originalHtmlOverflow = document.documentElement.style.overflow;
      originalBodyOverscroll = document.body.style.overscrollBehavior;
      originalHtmlOverscroll = document.documentElement.style.overscrollBehavior;
      originalBodyPosition = document.body.style.position;
      originalBodyTop = document.body.style.top;
      originalBodyLeft = document.body.style.left;
      originalBodyRight = document.body.style.right;
      originalBodyWidth = document.body.style.width;
      originalBodyPaddingRight = document.body.style.paddingRight;

      // Pin body at the current scroll offset so neither desktop nor mobile touch
      // viewports can scroll the blurred background behind an open modal.
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.style.overscrollBehavior = 'none';
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'none';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
    }
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.style.overflow = originalBodyOverflow || '';
        document.documentElement.style.overflow = originalHtmlOverflow || '';
        document.body.style.overscrollBehavior = originalBodyOverscroll || '';
        document.documentElement.style.overscrollBehavior = originalHtmlOverscroll || '';
        document.body.style.position = originalBodyPosition || '';
        document.body.style.top = originalBodyTop || '';
        document.body.style.left = originalBodyLeft || '';
        document.body.style.right = originalBodyRight || '';
        document.body.style.width = originalBodyWidth || '';
        document.body.style.paddingRight = originalBodyPaddingRight || '';

        if (savedScrollY > 0 && typeof window.scrollTo === 'function') {
          try {
            window.scrollTo(0, savedScrollY);
          } catch {
            // Ignore in non-browser environments (e.g. jsdom)
          }
        }
        savedScrollY = 0;
      }
    };
  }, [active]);
}
