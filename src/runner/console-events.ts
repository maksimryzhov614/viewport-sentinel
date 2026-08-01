import type { ConsoleMessage, Page } from 'playwright';
import { normalizeMessage, sanitizeUrl } from '../core/privacy.js';

const STACK_LOCATION =
  /([A-Za-z][A-Za-z\d+.-]*:(?:\/\/)?[^\s()]*):(\d+):(\d+)(?=\)?(?:\s|$))/u;

export interface ConsoleEvent {
  eventType: 'console.error' | 'pageerror';
  message: string;
  sourceUrl: string;
  line: number;
  column: number;
}

export interface ConsoleCapture {
  stop(): void;
  events(): readonly ConsoleEvent[];
}

function normalizedEvent(event: ConsoleEvent): ConsoleEvent {
  return Object.freeze({
    eventType: event.eventType,
    message: normalizeMessage(event.message),
    sourceUrl: sanitizeUrl(event.sourceUrl),
    line: event.line,
    column: event.column,
  });
}

function pageErrorLocation(stack: string | undefined): {
  sourceUrl: string;
  line: number;
  column: number;
} {
  const match = stack === undefined ? null : STACK_LOCATION.exec(stack);
  if (match === null) {
    return { sourceUrl: '<inline>', line: 0, column: 0 };
  }

  const sourceUrl = match[1];
  const line = Number(match[2]);
  const column = Number(match[3]);
  if (
    sourceUrl === undefined ||
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(column)
  ) {
    return { sourceUrl: '<inline>', line: 0, column: 0 };
  }

  return { sourceUrl, line, column };
}

export function attachConsoleCapture(page: Page): ConsoleCapture {
  const captured: ConsoleEvent[] = [];
  let stopped = false;

  const onConsole = (message: ConsoleMessage): void => {
    if (stopped || message.type() !== 'error' || message.args().length === 0) {
      return;
    }

    const location = message.location();
    captured.push(
      normalizedEvent({
        eventType: 'console.error',
        message: message.text(),
        sourceUrl: location.url,
        line: location.line,
        column: location.column,
      }),
    );
  };

  const onPageError = (error: Error): void => {
    if (stopped) {
      return;
    }

    const location = pageErrorLocation(error.stack);
    captured.push(
      normalizedEvent({
        eventType: 'pageerror',
        message: error.message,
        ...location,
      }),
    );
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  return {
    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        page.off('console', onConsole);
      } finally {
        page.off('pageerror', onPageError);
      }
    },
    events(): readonly ConsoleEvent[] {
      return Object.freeze([...captured]);
    },
  };
}
