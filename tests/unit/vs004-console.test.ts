import { describe, expect, it } from 'vitest';
import type { ConsoleMessage, JSHandle, Page } from 'playwright';
import { capDrafts } from '../../src/core/findings.js';
import {
  attachConsoleCapture,
  type ConsoleEvent,
} from '../../src/runner/console-events.js';
import { evaluateVS004 } from '../../src/rules/vs004-console.js';

type ConsoleListener = (message: ConsoleMessage) => void;
type PageErrorListener = (error: Error) => void;

class FakePage {
  readonly consoleListeners = new Set<ConsoleListener>();
  readonly pageErrorListeners = new Set<PageErrorListener>();
  readonly removedConsoleListeners: ConsoleListener[] = [];
  readonly removedPageErrorListeners: PageErrorListener[] = [];

  on(event: 'console' | 'pageerror', listener: unknown): this {
    if (event === 'console') {
      this.consoleListeners.add(listener as ConsoleListener);
    } else {
      this.pageErrorListeners.add(listener as PageErrorListener);
    }
    return this;
  }

  off(event: 'console' | 'pageerror', listener: unknown): this {
    if (event === 'console') {
      const consoleListener = listener as ConsoleListener;
      this.removedConsoleListeners.push(consoleListener);
      this.consoleListeners.delete(consoleListener);
    } else {
      const pageErrorListener = listener as PageErrorListener;
      this.removedPageErrorListeners.push(pageErrorListener);
      this.pageErrorListeners.delete(pageErrorListener);
    }
    return this;
  }

  emitConsole(message: ConsoleMessage): void {
    for (const listener of this.consoleListeners) {
      listener(message);
    }
  }

  emitPageError(error: Error): void {
    for (const listener of this.pageErrorListeners) {
      listener(error);
    }
  }
}

function rawConsole(
  message: string,
  sourceUrl = '<inline>',
  line = 0,
  column = 0,
  eventType: ConsoleEvent['eventType'] = 'console.error',
): ConsoleEvent {
  return { eventType, message, sourceUrl, line, column };
}

function consoleMessage({
  type = 'error',
  text,
  url = '',
  line = 0,
  column = 0,
  argumentCount = 1,
}: {
  type?: ReturnType<ConsoleMessage['type']>;
  text: string;
  url?: string;
  line?: number;
  column?: number;
  argumentCount?: number;
}): ConsoleMessage {
  const handles = Array.from({ length: argumentCount }, () => ({}) as JSHandle);
  return {
    args: () => handles,
    location: () => ({
      url,
      line,
      column,
      lineNumber: line,
      columnNumber: column,
    }),
    page: () => null,
    text: () => text,
    timestamp: () => 0,
    type: () => type,
    worker: () => null,
  };
}

function errorWithStack(message: string, stack?: string): Error {
  const error = new Error(message);
  if (stack === undefined) {
    Reflect.deleteProperty(error, 'stack');
  } else {
    error.stack = stack;
  }
  return error;
}

describe('evaluateVS004', () => {
  it('deduplicates exact normalized events before applying literal ignores', () => {
    const events = [
      rawConsole(' Boom\n ', 'https://x.test/a?token=1', 2, 4),
      rawConsole('Boom', 'https://x.test/a?other=2', 2, 4),
      rawConsole(' Known\tdev noise ', '<inline>', 0, 0),
      rawConsole('Known dev noise', 'not a URL', 0, 0),
    ];

    const result = evaluateVS004(events, ['Known dev']);

    expect(result.drafts).toHaveLength(1);
    expect(result.suppressedCount).toBe(1);
    expect(result.drafts[0]).toEqual({
      ruleId: 'VS004',
      severity: 'error',
      message: 'Boom',
      selector: 'document',
      evidence: {
        kind: 'console',
        eventType: 'console.error',
        message: 'Boom',
        sourceUrl: 'https://x.test/a',
        line: 2,
        column: 4,
      },
      identity: ['console.error', 'Boom', 'https://x.test/a', 2, 4],
    });
  });

  it('does not suppress anything when the ignore list is empty', () => {
    const result = evaluateVS004(
      [rawConsole('Known dev noise'), rawConsole('Another error')],
      [],
    );

    expect(result.drafts.map(({ message }) => message)).toEqual([
      'Known dev noise',
      'Another error',
    ]);
    expect(result.suppressedCount).toBe(0);
  });

  it('uses case-sensitive exact literal substring ignores', () => {
    const result = evaluateVS004(
      [rawConsole('Known dev noise'), rawConsole('Known developer failure')],
      ['known dev', 'Known dev noise'],
    );

    expect(result.drafts.map(({ message }) => message)).toEqual([
      'Known developer failure',
    ]);
    expect(result.suppressedCount).toBe(1);
  });

  it('sanitizes source and message URLs including credentials and default ports', () => {
    const result = evaluateVS004(
      [
        rawConsole(
          'Fetch failed at http://user:pass@api.test:80/data?token=hidden#fragment',
          'https://alice:secret@example.test:443/app.js?key=hidden#frame',
          7,
          9,
        ),
      ],
      [],
    );

    expect(result.drafts[0]).toMatchObject({
      message: 'Fetch failed at http://api.test/data',
      evidence: {
        sourceUrl: 'https://example.test/app.js',
      },
      identity: [
        'console.error',
        'Fetch failed at http://api.test/data',
        'https://example.test/app.js',
        7,
        9,
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /user|pass|alice|secret|token|hidden|fragment|key|frame/u,
    );
  });

  it('keeps the same message distinct when type or location differs', () => {
    const events = [
      rawConsole('Boom', 'https://x.test/a.js', 1, 2),
      rawConsole('Boom', 'https://x.test/a.js', 1, 3),
      rawConsole('Boom', 'https://x.test/b.js', 1, 2),
      rawConsole('Boom', 'https://x.test/a.js', 1, 2, 'pageerror'),
    ];

    expect(
      evaluateVS004(events, []).drafts.map(({ identity }) => identity),
    ).toEqual([
      ['console.error', 'Boom', 'https://x.test/a.js', 1, 2],
      ['console.error', 'Boom', 'https://x.test/a.js', 1, 3],
      ['console.error', 'Boom', 'https://x.test/b.js', 1, 2],
      ['pageerror', 'Boom', 'https://x.test/a.js', 1, 2],
    ]);
  });

  it('caps messages at 2,000 Unicode code points without splitting a code point', () => {
    const result = evaluateVS004([rawConsole(`${'😀'.repeat(1_999)}a😀`)], []);
    const message = result.drafts[0]?.message ?? '';

    expect(Array.from(message)).toHaveLength(2_000);
    expect(message).toBe(`${'😀'.repeat(1_999)}a`);
  });

  it('preserves first arrival order without a local 25-item cap', () => {
    const events = Array.from({ length: 28 }, (_, index) =>
      rawConsole(`error-${String(index)}`),
    );

    const result = evaluateVS004(events, []);

    expect(result.drafts).toHaveLength(28);
    expect(result.drafts.map(({ message }) => message)).toEqual(
      Array.from({ length: 28 }, (_, index) => `error-${String(index)}`),
    );
    expect(capDrafts(result.drafts)).toMatchObject({
      findings: result.drafts.slice(0, 25),
      omittedFindingCount: 3,
    });
  });
});

describe('attachConsoleCapture', () => {
  it('captures console API errors without reading argument values and excludes other console events', () => {
    const page = new FakePage();
    const capture = attachConsoleCapture(page as unknown as Page);

    page.emitConsole(
      consoleMessage({ type: 'warning', text: 'warning with an argument' }),
    );
    page.emitConsole(
      consoleMessage({
        text: 'browser-generated network failure',
        argumentCount: 0,
      }),
    );
    page.emitConsole(
      consoleMessage({
        text: ' console API failure ',
        url: 'https://user:pass@example.test:443/app.js?token=hidden#frame',
        line: 4,
        column: 6,
      }),
    );

    expect(capture.events()).toEqual([
      rawConsole('console API failure', 'https://example.test/app.js', 4, 6),
    ]);
  });

  it('extracts only the first absolute stack location and falls back for stackless errors', () => {
    const page = new FakePage();
    const capture = attachConsoleCapture(page as unknown as Page);

    page.emitPageError(
      errorWithStack(
        ' First page failure ',
        [
          'Error: stack-only-secret',
          '    at first (https://user:pass@example.test:443/app.js?token=hidden:12:34)',
          '    at second (https://other.test/secret.js:56:78)',
        ].join('\n'),
      ),
    );
    page.emitPageError(
      errorWithStack(
        'Second page failure',
        'handler@http://example.test:80/main.js?key=hidden:7:9',
      ),
    );
    page.emitPageError(errorWithStack('Inline failure'));

    expect(capture.events()).toEqual([
      rawConsole(
        'First page failure',
        'https://example.test/app.js',
        12,
        34,
        'pageerror',
      ),
      rawConsole(
        'Second page failure',
        'http://example.test/main.js',
        7,
        9,
        'pageerror',
      ),
      rawConsole('Inline failure', '<inline>', 0, 0, 'pageerror'),
    ]);
    expect(JSON.stringify(capture.events())).not.toMatch(
      /stack-only-secret|other\.test|secret\.js|token|hidden|key/u,
    );
  });

  it('removes the exact listeners once and rejects stale post-stop callbacks', () => {
    const page = new FakePage();
    const capture = attachConsoleCapture(page as unknown as Page);
    const consoleListener = [...page.consoleListeners][0];
    const pageErrorListener = [...page.pageErrorListeners][0];

    expect(consoleListener).toBeDefined();
    expect(pageErrorListener).toBeDefined();
    capture.stop();
    capture.stop();

    expect(page.consoleListeners.size).toBe(0);
    expect(page.pageErrorListeners.size).toBe(0);
    expect(page.removedConsoleListeners).toEqual([consoleListener]);
    expect(page.removedPageErrorListeners).toEqual([pageErrorListener]);

    consoleListener?.(consoleMessage({ text: 'late console error' }));
    pageErrorListener?.(errorWithStack('late page error'));
    expect(capture.events()).toEqual([]);
  });
});
