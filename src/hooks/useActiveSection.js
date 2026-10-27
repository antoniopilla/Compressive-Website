/**
 * Tracks which page section is in view, so navigation can mark the current
 * item. A section counts as current while it crosses a thin band just above
 * the middle of the viewport; at the very bottom of the page the last section
 * wins, even if it is too short to reach that band.
 */

import { useEffect, useState } from 'react';

/**
 * @param {readonly string[]} ids  Section element ids, in page order. Pass a stable array.
 * @returns {string} The id of the current section.
 */
export function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return undefined;
    const inBand = new Map();
    const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    const update = () => {
      if (atBottom()) {
        setActive(ids[ids.length - 1]);
        return;
      }
      const current = ids.find((id) => inBand.get(id));
      if (current) setActive(current);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) inBand.set(entry.target.id, entry.isIntersecting);
        update();
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update);
    };
  }, [ids]);

  return active;
}
