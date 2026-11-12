/**
 * The page's main sections, in order. The header navigation and the footer
 * both read from this list, so labels stay identical everywhere. Each `id` is
 * the id of a section element on the page. The opening above the first one
 * belongs to it, so "Compress" stays current at the top of the page.
 */
export const SECTIONS = Object.freeze([
  { id: 'workspace', label: 'Compress' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'privacy', label: 'Privacy' },
]);

export const SECTION_IDS = Object.freeze(SECTIONS.map((section) => section.id));
