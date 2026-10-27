# Task: Redesign this entire website with an animated flat UI/UX design

Redesign the visual design and user experience of my whole website. The result must be flat, animated, user-friendly, easy to navigate, and easy to find things in. You choose the colors, typography, and layout details. Keep all existing content, features, routes, and backend logic working.

## Step 1: Inspect first

1. Read the repo structure, `package.json` (or equivalent), README, and any `CLAUDE.md`.
2. Identify the framework, styling approach (Tailwind, CSS modules, SCSS, plain CSS), routing, and shared layout components.
3. List every page and template, and the main user tasks on the site (for example: find a product, read an article, contact us, sign in).
4. Work directly on the main branch. Do not create a separate branch.
5. Write a short plan: the design direction you chose, the palette, the files you will change, and the order of work. Then proceed without waiting, unless something blocks you.

## Step 2: Design direction (you decide)

**Flat design rules**
- No drop shadows, no gradients, no bevels, no textures. Depth comes from solid color blocks, spacing, and borders only.
- Solid fills, simple shapes, consistent rounded corners, simple line or solid icons from one icon set.
- Generous whitespace and a clear visual hierarchy.

**Colors**
- Choose a cohesive palette yourself: one primary, one secondary, one accent, neutrals, and four status colors (success, warning, error, info).
- Pick colors that fit the site's purpose and audience.
- Provide light and dark themes. Follow `prefers-color-scheme` and add a visible theme toggle.
- All text and interactive elements must meet WCAG AA contrast in both themes.

**Typography**
- One or two typefaces at most, with a clear scale for headings, body, and captions.
- Body text at least 16px, comfortable line height, sentence case.
- Use system fonts or a font the project already loads, unless a new font clearly improves the design.

**Design tokens**
- Put everything in CSS variables or the project's theme config: colors, spacing scale, radii, type scale, animation durations and easings. Components must use the tokens, not hard-coded values.

## Step 3: UX requirements (navigation and findability)

- **Clear navigation:** one consistent primary navigation on every page, labeled in plain words, with the current page clearly marked. Keep it to the few items users need most.
- **Mobile navigation:** a simple menu that is easy to reach with a thumb, with large tap targets (at least 44px).
- **Search:** add or improve search so users can find content quickly, if the site has more than a handful of pages or items.
- **Breadcrumbs or a clear back path** on deeper pages.
- **Obvious primary action** on each page, styled as the most prominent button.
- **Consistent patterns:** the same button, link, form, card, and table styles everywhere.
- **Forms:** visible labels, helpful inline error messages, clear success states.
- **Footer:** include the key links people look for (contact, support, legal).
- **Fast scanning:** short sections, descriptive headings, and visible structure on long pages.
- Do not remove or rename existing URLs. Keep SEO tags, metadata, and alt text intact.

## Step 4: Animation

Animation must help users understand the interface, never slow them down.
- **Page load:** a quick, subtle fade and slide-up of main content (200 to 400ms).
- **Navigation:** smooth page or route transitions where the framework supports them.
- **Hover and focus:** buttons, links, and cards respond with a small color change or 2 to 4px movement (120 to 200ms).
- **Menus and modals:** slide or fade in and out with a short duration (200 to 300ms).
- **Scroll reveals:** sections ease in once as they enter the viewport. Do not repeat on scroll back.
- **Feedback:** loading spinners or skeletons, button press states, and a clear animated confirmation after form submission.
- **Icons and micro-interactions:** use sparingly for status changes (toggle, checkmark, expand and collapse).
- Prefer CSS transitions and animations. Only animate `transform` and `opacity` where possible. Add an animation library only if the project already uses one.
- Respect `prefers-reduced-motion`: remove movement and show state changes instantly.

## Step 5: Quality requirements

- Responsive from 320px to wide desktop, with no horizontal scrolling.
- Fully keyboard accessible, with a visible focus ring and logical tab order. Use semantic HTML and correct ARIA only where needed.
- No layout shift on load. Keep performance at least as good as before: no large new dependencies, optimized images, lazy-load below-the-fold media.
- Keep the project's linting, formatting, and naming conventions.
- Do not change business logic, API calls, data models, or copy, unless text must change for clarity in navigation labels. Tell me about any such change.

## Step 6: Work in stages

1. Design tokens and global styles (colors, type, spacing, themes).
2. Shared layout: header, navigation, footer, buttons, forms, cards.
3. Page-by-page redesign, starting with the home page, then the most used pages.
4. Animations and micro-interactions.
5. Accessibility, responsiveness, and performance pass.

Commit directly to main after each stage with a clear message. Run the build, linter, and tests after each stage and fix anything you broke.

## Step 7: Verify

If you can run the dev server, check every page at 375px, 768px, and 1280px in both themes. Confirm that navigation, search, forms, and all existing features still work, and that reduced-motion mode works.

## Step 8: Report back

Reply with: the palette and typography you chose and why, the files changed, what you improved in navigation and findability, any content or behavior changes, and anything you could not verify. Keep it short.
