/**
 * The page's main sections, in order. The header navigation, the mobile
 * bottom bar and the footer all read from this list, so labels stay identical
 * everywhere. Each `id` is the id of a section element on the page.
 */
export const SECTIONS = Object.freeze([
  { id: 'tools', label: 'Tools' },
  { id: 'workspace', label: 'Compress' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'privacy', label: 'Privacy' },
]);

export const SECTION_IDS = Object.freeze(SECTIONS.map((section) => section.id));
