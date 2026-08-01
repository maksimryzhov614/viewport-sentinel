import type { Page } from 'playwright';
import { normalizeMessage } from '../core/privacy.js';
import type {
  NormalizedPageSpec,
  ReadinessDeadline,
  ReadinessStage,
} from '../model/types.js';

const MOTION_DISABLING_CSS = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

export class ReadinessError extends Error {
  override readonly name = 'ReadinessError';

  constructor(
    readonly stage: ReadinessStage,
    message: string,
  ) {
    super(message);
  }
}

export function createReadinessDeadline(timeoutMs: number): ReadinessDeadline {
  return Object.freeze({ expiresAt: Date.now() + timeoutMs });
}

function remainingMs(deadline: ReadinessDeadline): number {
  return Math.max(0, deadline.expiresAt - Date.now());
}

function errorMessage(error: unknown, stage: ReadinessStage): string {
  const rawMessage =
    error instanceof Error ? error.message : `Readiness failed during ${stage}`;
  const sanitized = normalizeMessage(rawMessage);
  return sanitized === '' ? `Readiness failed during ${stage}` : sanitized;
}

export async function runReadinessStage<T>(
  stage: ReadinessStage,
  deadline: ReadinessDeadline,
  operation: (timeoutMs: number) => Promise<T>,
): Promise<T> {
  const timeoutMs = remainingMs(deadline);
  if (timeoutMs <= 0) {
    throw new ReadinessError(
      stage,
      `Readiness deadline exceeded during ${stage}`,
    );
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(timeoutMs),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Readiness deadline exceeded during ${stage}`));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    throw new ReadinessError(stage, errorMessage(error, stage));
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function settlePage(
  page: Page,
  pageSpec: NormalizedPageSpec,
  deadline: ReadinessDeadline,
): Promise<void> {
  const readySelector = pageSpec.readySelector;
  if (readySelector !== undefined) {
    await runReadinessStage('ready-selector', deadline, async (timeoutMs) => {
      await page.waitForSelector(readySelector, { timeout: timeoutMs });
    });
  }

  await runReadinessStage('fonts', deadline, async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
  });

  await runReadinessStage('layout', deadline, async () => {
    await page.addStyleTag({ content: MOTION_DISABLING_CSS });
    await page.evaluate(async () => {
      let previousWidth: number | undefined;
      let previousHeight: number | undefined;
      let stableFrames = 0;

      while (stableFrames < 3) {
        const [width, height] = await new Promise<[number, number]>(
          (resolve) => {
            requestAnimationFrame(() => {
              resolve([
                document.documentElement.scrollWidth,
                document.documentElement.scrollHeight,
              ]);
            });
          },
        );

        if (width === previousWidth && height === previousHeight) {
          stableFrames += 1;
        } else {
          previousWidth = width;
          previousHeight = height;
          stableFrames = 1;
        }
      }
    });
  });
}
