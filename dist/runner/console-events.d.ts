import type { Page } from 'playwright';
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
export declare function attachConsoleCapture(page: Page): ConsoleCapture;
//# sourceMappingURL=console-events.d.ts.map