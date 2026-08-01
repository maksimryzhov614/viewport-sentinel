import type { Page } from 'playwright';
import { roundCss, roundRect } from '../core/privacy.js';
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
    offenders: readonly { selector: string; rect: Rect }[];
  };
  overlaps: readonly OverlapSnapshot[];
  images: readonly ImageSnapshot[];
}

export async function captureBrowserSnapshot(
  page: Page,
): Promise<BrowserSnapshot> {
  const snapshot = await page.evaluate(() => {
    function rectValue(rect: {
      x: number;
      y: number;
      width: number;
      height: number;
      top: number;
      right: number;
      bottom: number;
      left: number;
    }): Rect {
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
      };
    }

    function isRendered(element: Element): boolean {
      if (!element.isConnected) {
        return false;
      }

      let opacity = 1;
      for (
        let current: Element | null = element;
        current !== null;
        current = current.parentElement
      ) {
        const style = getComputedStyle(current);
        if (
          current.hasAttribute('hidden') ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          style.contentVisibility === 'hidden'
        ) {
          return false;
        }
        opacity *= Number.parseFloat(style.opacity);
      }

      const rect = element.getBoundingClientRect();
      return (
        opacity > 0.01 &&
        element.getClientRects().length > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function clipsAxis(value: string): boolean {
      return (
        value === 'hidden' ||
        value === 'clip' ||
        value === 'auto' ||
        value === 'scroll'
      );
    }

    function clippedRect(element: Element): Rect | null {
      const bounding = element.getBoundingClientRect();
      let left = bounding.left;
      let right = bounding.right;
      let top = bounding.top;
      let bottom = bounding.bottom;

      for (
        let ancestor = element.parentElement;
        ancestor !== null;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        if (clipsAxis(style.overflowX)) {
          left = Math.max(left, ancestorRect.left);
          right = Math.min(right, ancestorRect.right);
        }
        if (clipsAxis(style.overflowY)) {
          top = Math.max(top, ancestorRect.top);
          bottom = Math.min(bottom, ancestorRect.bottom);
        }
      }

      if (right <= left || bottom <= top) {
        return null;
      }

      return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        top,
        right,
        bottom,
        left,
      };
    }

    function nearestHorizontalClippingAncestor(
      element: Element,
    ): Element | null {
      for (
        let ancestor = element.parentElement;
        ancestor !== null;
        ancestor = ancestor.parentElement
      ) {
        if (clipsAxis(getComputedStyle(ancestor).overflowX)) {
          return ancestor;
        }
      }
      return null;
    }

    function diagnosticSelector(element: Element): string {
      for (const attribute of ['data-testid', 'data-test', 'data-qa']) {
        const value = element.getAttribute(attribute);
        if (value !== null) {
          const candidate = `[${attribute}="${CSS.escape(value)}"]`;
          if (document.querySelectorAll(candidate).length === 1) {
            return candidate;
          }
        }
      }

      if (element.id !== '') {
        const candidate = `#${CSS.escape(element.id)}`;
        if (document.querySelectorAll(candidate).length === 1) {
          return candidate;
        }
      }

      const segments: string[] = [];
      let current: Element | null = element;
      while (current !== null && segments.length < 6) {
        const tag = current.tagName.toLowerCase();
        let index = 1;
        for (
          let sibling = current.previousElementSibling;
          sibling !== null;
          sibling = sibling.previousElementSibling
        ) {
          if (sibling.tagName.toLowerCase() === tag) {
            index += 1;
          }
        }
        segments.push(`${tag}:nth-of-type(${String(index)})`);
        current = current.parentElement;
      }

      const selector = segments.reverse().join(' > ');
      return current === null ? selector : `<truncated> > ${selector}`;
    }

    const viewportWidth = document.documentElement.clientWidth;
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      // The DOM typing is non-null, but browsers may expose no body for non-HTML documents.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      document.body?.scrollWidth ?? 0,
    );
    const offenders: { selector: string; rect: Rect }[] = [];

    if (documentWidth > viewportWidth + 1) {
      for (const element of document.querySelectorAll('*')) {
        if (!isRendered(element)) {
          continue;
        }

        const rect = clippedRect(element);
        if (
          rect === null ||
          (rect.left >= -1 && rect.right <= viewportWidth + 1)
        ) {
          continue;
        }

        const clippingAncestor = nearestHorizontalClippingAncestor(element);
        if (clippingAncestor !== null) {
          const overflowX = getComputedStyle(clippingAncestor).overflowX;
          const ancestorRect = clippedRect(clippingAncestor);
          if (
            (overflowX === 'auto' || overflowX === 'scroll') &&
            ancestorRect !== null &&
            ancestorRect.left >= -1 &&
            ancestorRect.right <= viewportWidth + 1
          ) {
            continue;
          }
        }

        offenders.push({
          selector: diagnosticSelector(element),
          rect: rectValue(rect),
        });
        if (offenders.length === 10) {
          break;
        }
      }
    }

    return {
      overflow: { viewportWidth, documentWidth, offenders },
      overlaps: [],
      images: [],
    };
  });

  return {
    overflow: {
      viewportWidth: roundCss(snapshot.overflow.viewportWidth),
      documentWidth: roundCss(snapshot.overflow.documentWidth),
      offenders: snapshot.overflow.offenders.map(({ selector, rect }) => ({
        selector,
        rect: roundRect(rect),
      })),
    },
    overlaps: [],
    images: [],
  };
}
