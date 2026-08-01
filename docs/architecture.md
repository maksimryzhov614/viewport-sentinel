# Architecture

Viewport Sentinel is a local Node.js CLI and composite GitHub Action around one
deterministic audit pipeline:

```text
JSON config
  -> validation and normalization
  -> serial page × viewport runner
  -> fresh deterministic Chromium context
  -> navigation and shared-deadline settling
  -> browser snapshot plus captured page events
  -> VS001–VS004 projectors (or VSRUN001 on readiness failure)
  -> caps, fingerprints, and canonical ordering
  -> terminal / JSON / SARIF / GitHub projectors
  -> CLI or fail-last Action status
```

## Configuration boundary

The strict version-1 schema accepts 1–50 explicitly listed pages and 1–12
explicitly listed viewports. A page has either an absolute HTTP(S) `url` or a
`path` resolved against `baseUrl`, never both. Page and viewport names are
unique lowercase identifiers. The timeout is one 1,000–60,000 ms deadline for
each page/viewport combination, not a fresh timeout per readiness stage.

## Execution boundary

One Chromium process serves the audit. Combinations run serially in config
order, each in a fresh context with its configured viewport and device scale
factor, UTC, `en-US`, light color scheme, reduced motion, and blocked service
workers. Navigation waits for `domcontentloaded`; settling then waits for an
optional ready selector, `document.fonts.ready`, disabled CSS motion, and three
stable animation frames of document width and height.

No scroll, click, form input, crawler, authentication step, or custom page
script is performed. Snapshot queries start at `document` and therefore do not
traverse open or closed shadow roots.

## Findings and reports

After settling, one browser evaluation captures overflow diagnostics, visible
actionable/overlay geometry, and applicable images. Console and uncaught page
errors are captured from navigation through the snapshot. Pure projectors turn
that evidence into findings; each content rule is capped at 25 findings per
combination, with omitted counts retained.

Findings are fingerprinted, ordered by config page, config viewport, fixed rule
order, selector, and fingerprint, then serialized canonically. JSON and SARIF
contain no timestamps or duration. A readiness failure produces `VSRUN001` for
that combination; an internal execution failure preserves a canonical partial
report where possible.

The Action's audit step always exits successfully after saving status outputs.
Its later upload and finalizer steps preserve reports and the GitHub summary
before propagating exit `0`, `1`, or `2`.
