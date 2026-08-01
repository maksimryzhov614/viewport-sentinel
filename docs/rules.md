# Rule reference

All findings have severity `error`. Content-rule results are emitted in fixed
order `VS001`, `VS002`, `VS003`, `VS004`, with at most 25 findings per rule per
page/viewport combination. Extra results are counted in
`totals.omittedFindingCount` and `totals.omittedByCombination`. VS001 itself can
emit only one finding and includes at most 10 offender rectangles.

Visibility is evaluated at the initial scroll position after readiness; the
tool never scrolls. An element is rendered only when it is connected, no
ancestor is hidden or has `display: none`, `visibility: hidden|collapse`, or
`content-visibility: hidden`, cumulative opacity is greater than `0.01`, it has
a client rect, and its bounding box has positive width and height. Viewport
visibility also clips geometry to clipping ancestors and the viewport and
requires at least one square CSS pixel. Queries use the document tree and do
not enter open or closed shadow roots.

<a id="vsrun001"></a>

## VSRUN001 — page readiness failure

Emitted instead of content rules when a combination cannot complete one of the
shared-deadline readiness stages:

1. `navigation`: `page.goto` waits for `domcontentloaded`.
2. `ready-selector`: the optional page selector becomes available.
3. `fonts`: `document.fonts.ready` resolves.
4. `layout`: motion-disabling CSS is installed and document width and height
   remain unchanged for three animation frames.

The single configured `timeoutMs` budget covers all stages. A failed
combination increments `failedReadiness`, produces a complete audit report with
the runtime finding, and results in CLI or Action status `1`. Exit `2` is
reserved for invalid configuration, browser launch, internal, or report-writing
failures.

<a id="vs001"></a>

## VS001 — horizontal overflow

Emitted once when the larger of the root or body `scrollWidth` is more than one
CSS pixel wider than `document.documentElement.clientWidth`. The message and
evidence report the rounded width difference.

Up to 10 rendered document-tree elements extending more than one CSS pixel
beyond either viewport edge are included as diagnostics. Ancestor clipping is
honored. An element in an on-screen `overflow-x: auto|scroll` container is not
reported merely because that container intentionally scrolls horizontally.

<a id="vs002"></a>

## VS002 — blocked actionable control

Actionable candidates are visible `a[href]`, `button`, `input`, `select`,
`textarea`, `[role="button"]`, and appropriate `[tabindex]` elements. Disabled,
`aria-disabled="true"`, inert, `pointer-events: none`, clipped, and standalone
`tabindex="-1"` candidates are excluded.

Potential covers are visible fixed or sticky elements with cumulative opacity
greater than `0.01` and pointer events enabled. Related ancestor/descendant
pairs are excluded. A pair becomes a finding when `elementFromPoint` confirms
the cover at the target center, or when overlap is strictly greater than 25%
of target area and at least one point in a 3 × 3 overlap sample hits the cover.
Only controls visible in the initial viewport are tested; no scroll sequence is
performed.

<a id="vs003"></a>

## VS003 — browser-selected image failure

Checks rendered `<img>` elements that have a `src`, `srcset`, or parent
`<picture><source srcset>`. The browser's actual `currentSrc` is recorded along
with absolute source candidates. An image fails when `currentSrc` is empty,
`complete` is false, either natural dimension is below 1, or `decode()` rejects.

Decode waiting is capped at two seconds and a timeout is retained as evidence;
a timeout alone is not a failure when the image is otherwise complete with
positive natural dimensions. A below-fold `loading="lazy"` image is excluded
at the initial scroll position. Rendered non-lazy images remain eligible even
when below the fold.

<a id="vs004"></a>

## VS004 — browser runtime error

Captures `console.error` calls with at least one argument and uncaught
`pageerror` events from navigation through snapshot capture. Other console
levels and zero-argument `console.error()` calls are ignored. Exact duplicate
events are removed using event type, normalized message, sanitized source URL,
line, and column.

Each page's `consoleIgnore` entries are literal, case-sensitive substring
matches against the normalized and URL-sanitized message. Matching unique
events are omitted and counted in `totals.suppressedConsoleCount`; ignores are
not regular expressions and do not suppress other rule types.

## Privacy and normalization

Reported URLs remove usernames, passwords, query strings, and fragments.
HTTP(S) URLs embedded in messages are sanitized the same way. Messages are NFC
normalized, whitespace-collapsed, trimmed, and capped at 2,000 Unicode code
points. Invalid or inline source URLs become `<inline>`. CSS geometry is rounded
to two decimal places.

Sanitization is not anonymization: paths, selectors, and message text can still
be sensitive. Inspect reports before sharing them. Viewport Sentinel does not
send telemetry or upload reports to a hosted service; GitHub Action artifacts
stay within the caller's workflow retention boundary.
