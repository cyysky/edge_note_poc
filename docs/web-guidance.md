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

## `dialog` - capture dialog

- The camera and microphone capture share the native-dialog pattern above:
  `showModal()`, `aria-labelledby` on the heading, `autofocus` on the
  shutter or stop button, and no synthetic `role="dialog"` or focus trap.
- `onCancel` calls `preventDefault()` and then closes through React state, so
  the device stream is released by the same path as the Cancel button. A browser
  Esc cannot close the dialog while a camera or microphone is still live.
- The component is mounted only while the dialog is open, so mounting _is_
  opening: `showModal()` runs once on mount and no prop drives visibility.
  `close()` runs before the parent unmounts, which is what returns focus to the
  invoker; unmounting an open dialog would drop focus on `<body>`.
- The preview sits in a fixed `aspect-ratio` box, so the dialog does not jump
  when the first frame arrives.

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

## `forms` - chat composer

- Every control has a real `<label for>`: the message textarea, both file
  inputs and the "Speak replies" checkbox. The file inputs are visually replaced
  by labels but stay in the tab order and keep their own label, rather than being
  hidden with `display: none`.
- The submit button is `type="submit"` inside a real `<form>`; the attachment
  remove buttons are `type="button"` so they cannot submit the composer, and each
  is labelled `Remove <file name>` rather than "Remove".
- Ctrl/Cmd+Enter submits through `requestSubmit()`, the same path as the button,
  so keyboard and pointer users cannot diverge. A plain Enter still inserts a
  newline.
- Send is disabled while a request is in flight and when there is neither text
  nor an attachment, which is the one state the API would reject anyway.
- Send is also disabled while any attachment's caption or transcript is still
  being derived, and `handleSubmit` re-checks that state itself. The key handler
  calls `requestSubmit()`, which bypasses a disabled button, so the gate has to
  exist in the handler as well as in the markup.
- The button says `Listening…` while it waits on that derived text, so the
  disabled state explains itself instead of looking broken.

## `forms` - capture controls

- "Take photo" and "Record audio" are `type="button"` with
  `aria-haspopup="dialog"`; they open a dialog, they do not submit the composer.
- Both are disabled while a turn is in flight, like the file pickers, so a capture
  cannot race an in-progress request.
- The shutter and stop buttons stay disabled until the device is ready and while an
  encode is running, so a second click cannot double-attach.

## `privacy` - media stays local

- The camera or microphone is only requested from a click on a labelled button,
  never on page load. The dialog copy says the preview stays on this machine and
  that nothing is stored until the photo or clip is attached.
- The stream is stopped on capture, Cancel, Esc, unmount and `pagehide`, so no
  path leaves a preview running after the dialog is gone.
- Closing while the permission prompt is still up is its own path: the hook
  tracks that it was released and stops a stream that resolves afterwards, and
  `startRecording` takes an `AbortSignal` for the same case. A permission grant
  that arrives late must not switch the device on with no dialog to close it.
- A rejection is mapped to an actionable sentence (permission denied, no device,
  device busy) instead of the raw `DOMException` name.

## `security` - media capture needs a secure origin

- The camera and microphone are only requested from a page that can actually
  have them. `apps/web/src/lib/secure-context.ts` accepts `https:` and the
  loopback origins browsers treat as trustworthy (`localhost`, `*.localhost`,
  `127.0.0.0/8`, `[::1]`) and rejects a plain-HTTP LAN address, where Chrome
  hides `navigator.mediaDevices`.
- On such an origin `/chat` renders a persistent `.chat-notice` naming the exact
  address and the two commands that fix it. It is a paragraph, not a live
  region: the condition exists before the page is read, and the composer's
  single status region stays reserved for turn progress, so the same fact is
  never announced twice.
- The notice is a sibling of the log and the form, never inside the `<ol>` or
  the `role="alert"` error block, so a static condition cannot be confused with
  a failed turn.
- The fix is a local root CA plus a TLS terminator (`scripts/https-cert.ps1`,
  `scripts/https-serve.ps1`). No HSTS: RFC 6797 forbids caching it for an IP
  literal, and the guide's `max-age` rollout advice applies to named hosts.
- `local-network-access` is **not** the answer here. It gates a public HTTPS page
  asking to reach a LAN device; this app needs the LAN page itself to become
  trustworthy.

## `privacy` - say why a device is unavailable

- A hidden `getUserMedia` is indistinguishable from a denied permission or a
  missing device unless the page says which one it is. The notice states that
  the page is unencrypted, shows the origin, and names the server-side fix; it
  does not blame the person or ask them to change a browser setting that cannot
  help.
- The message names where the certificate goes (this device) and who serves it
  (this machine), matching the existing rule that media never leaves the
  machine.
- `describeMediaError` maps the resulting `NotSupportedError` to a message that
  says "use HTTPS" rather than echoing the platform error name.

## `accessible-error-announcement` - chat failure

- A failed turn renders `<div class="alert" role="alert">`, containing a
  `<strong>` headline and the detail as separate text.
- The composer has **one** visually hidden `role="status"` region, which reports
  "Waiting for the assistant." and "Generating spoken audio.", so a slow local
  model is not silence.
- A finished caption or transcript is announced through that same region, as
  `Caption for <file>: <text>`. The guidance is one polite region per page and
  warns that a region inserted already populated is not announced reliably, so
  the attachment card is plain text and only the always-present region changes.
  It carries the latest notice only; each new one replaces the previous, which
  keeps an older caption from being read again.
- A failed **speech** synthesis is swallowed on purpose: the text answer is the
  primary result and must not be replaced by an error about the enhancement.

## `lazy-load-video-and-audio` - transcript media

- Every `<audio>` player in the transcript uses `preload="metadata"`; attached
  audio is played through a `blob:` URL, so nothing is fetched twice.
- Replies are spoken only for turns the user asked to hear, and the toggle exists
  precisely so an expensive local synthesis is not run for every turn.

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
- Do not try to make a plain-HTTP LAN origin capture media. There is no browser
  flag, permission prompt or warning bypass that creates a secure context; only
  an HTTPS origin will do.
- Do not hide the file inputs with `display: none`; that removes them from the
  keyboard and accessibility tree.
- Do not turn a failed speech synthesis into a failed answer.
- Do not add a second live region for attachment status; the composer's single
  `role="status"` is the announcement path.
- Do not render the secure-context notice as an alert or a live region. It
  describes the origin, not a turn, and the error block stays reserved for a
  failed request.
- Do not let a turn send while a caption or transcript is still pending, and keep
  the check in both the button and the submit handler.
- Do not drop the English caption/transcript from a later turn; the bytes are
  gone, so that text is all the model has left of the attachment.
- Do not open the camera or microphone without a click; no auto-start previews.
- Do not leave a capture stream running after the dialog closes, and do not drop
  the `pagehide` release.
- Do not move the recorder to `MediaRecorder`; its WebM/Opus output is not
  readable by the model server.
