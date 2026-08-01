# Contributing

Viewport Sentinel accepts focused fixes and documented, test-backed changes.
Please open an issue before expanding the tool's deliberately narrow scope.

## Development setup

Use Node.js 22, 24, or 26. Install dependencies and the matching local browser:

```sh
npm ci
npx playwright install chromium
```

The fixture server binds only to loopback and serves files from `fixtures/site`.
Tests use dedicated ports and temporary output roots; do not point fixture tests
at customer or production systems.

## TDD and verification

Write the smallest failing test first and run it to record the expected RED.
Implement only enough behavior to pass it, then refactor while green. Useful
focused commands are:

```sh
npm run test:unit
npm run test:integration
npm test -- tests/path/to/focused.test.ts
```

Before submitting a change, verify three byte-identical report runs and the
complete local gate:

```sh
npm run build
npm run verify:determinism -- 3
npm run verify
```

Do not add timestamps, random IDs, durations, absolute local paths, secrets, or
environment-dependent ordering to canonical JSON or SARIF. When report output
changes intentionally, review the complete diff and update golden files in the
same change.
