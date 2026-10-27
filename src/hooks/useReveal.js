/**
 * Scroll reveal: an element that starts below the fold eases in once, the
 * first time it enters the viewport, and never animates again.
 *
 * The state lives in a `data-reveal` attribute ("pending" → "shown") that the
 * global stylesheet animates with opacity and transform only, so revealing
 * never shifts the layout. Elements already in view on load, browsers without
 * IntersectionObserver and visitors who prefer reduced motion get no effect.
 */

import { useEffect, useRef } from 'react';

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @returns {import('react').RefObject<HTMLElement>} Attach to the element to reveal. */
export function useReveal() {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver !== 'function' || prefersReducedMotion()) return undefined;
    if (element.getBoundingClientRect().top < window.innerHeight) return undefined; // already visible

    element.dataset.reveal = 'pending';
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        element.dataset.reveal = 'shown';
        observer.disconnect();
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (element.dataset.reveal === 'pending') delete element.dataset.reveal;
    };
  }, []);

  return ref;
}
