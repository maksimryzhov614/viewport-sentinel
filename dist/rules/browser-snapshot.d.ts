import type { Page } from 'playwright';
import type { Rect } from '../model/types.js';
export interface OverlapSnapshot {
    coverSelector: string;
    targetSelector: string;
    coverRect: Rect;
    targetRect: Rect;
    overlapRatio: number;
    centerCovered: boolean;
    sampledHit: boolean;
}
export interface ImageSnapshot {
    selector: string;
    currentSrc: string;
    sourceCandidates: readonly string[];
    complete: boolean;
    naturalWidth: number;
    naturalHeight: number;
    decode: 'resolved' | 'rejected' | 'timeout';
}
export interface BrowserSnapshot {
    overflow: {
        viewportWidth: number;
        documentWidth: number;
        offenders: readonly {
            selector: string;
            rect: Rect;
        }[];
    };
    overlaps: readonly OverlapSnapshot[];
    images: readonly ImageSnapshot[];
}
export declare function captureBrowserSnapshot(page: Page): Promise<BrowserSnapshot>;
//# sourceMappingURL=browser-snapshot.d.ts.map