# Web Guidance

The UI follows Google Chrome's Modern Web Guidance, installed at
`.agents/skills/modern-web-guidance/` (pinned in `skills-lock.json`). These are
the guides this app commits to; consult them before changing the matching code.

## `dialog` - note editor

- Native `<dialog>` driven by `showModal()`. The top layer, background
  inertness, focus containment, Esc handling and focus return are the browser's.
- No `role="dialog"`, no `aria-modal`, no focus trap: `<dialog>` already carries
  those semantics, and adding them double-announces to screen readers.
- `aria-labelledby` on the heading and `autofocus` on the first field.
- `dialog:modal { overscroll-behavior: contain }` and
  `dialog:modal::backdrop { overscroll-behavior: contain }` keep wheel and touch
  scrolling inside the dialog.
- The backdrop is styled as `dialog:modal::backdrop` only, so a non-modal
  dialog would never dim the page.
- `display` is never set unconditionally on `dialog`, which would defeat the
  browser's own show/hide behaviour.

## `responsive-table` - notes list

- `role="region"`, `tabIndex={0}` and `aria-labelledby` pointing at the
  `<caption>`, so keyboard users can scroll the table and screen readers
  announce it as a named region.
- Sticky `thead` and sticky `tbody th` (the row title) during vertical and
  horizontal scroll.
- `container-type: inline-size` on the scroll wrapper. The stacked card layout is
  a `@container (width < 44rem)` query, so it reacts to the table's own width
  rather than the viewport's.
- In stacked mode each `td` shows its column name via
  `td::before { content: attr(data-label) }` and `thead` is hidden, so no column
  header is lost.

## `forms` - dialog form

- A real `<label for>` for every control; hints are separate text, not
  placeholders.
- `:user-invalid` styles the field only after the user has interacted with it,
  never on first paint.
- `autocomplete="off"` on the free-text title; constrained `maxLength`.
- `noValidate` plus explicit disabling of Save keeps our validation authoritative
  while still exposing constraints in the markup.

## Typography and color

- `system-ui` stack with no webfont request.
- `text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs.
- `color-scheme: light dark` on `:root` so scrollbars and form controls match the
  theme before any CSS runs; dark mode is a
  `@media (prefers-color-scheme: dark)` token override.
- `prefers-reduced-motion` disables animation and transition durations.

## Rules that must not regress

- Do not replace the native dialog with a scripted modal.
- Do not drop `:modal` scoping from the backdrop rules.
- Do not add a dependency for behaviour the platform already provides.
