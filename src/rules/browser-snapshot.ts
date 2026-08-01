import type { Page } from 'playwright';
import { roundCss, roundRect, sanitizeUrl } from '../core/privacy.js';
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
  const snapshot = await page.evaluate(async () => {
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

    function effectiveOpacity(element: Element): number {
      let opacity = 1;
      for (
        let current: Element | null = element;
        current !== null;
        current = current.parentElement
      ) {
        opacity = Number.parseFloat(
          (
            opacity * Number.parseFloat(getComputedStyle(current).opacity)
          ).toPrecision(15),
        );
      }
      return opacity;
    }

    function isRendered(element: Element): boolean {
      if (!element.isConnected) {
        return false;
      }

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
      }

      const rect = element.getBoundingClientRect();
      return (
        effectiveOpacity(element) > 0.01 &&
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

    function positionedContainingBlock(
      element: Element,
    ): Element | null | undefined {
      const position = getComputedStyle(element).position;
      if (position !== 'absolute' && position !== 'fixed') {
        return undefined;
      }
      return element instanceof HTMLElement
        ? element.offsetParent
        : element.parentElement;
    }

    function ancestorClippedRect(element: Element): Rect | null {
      const bounding = element.getBoundingClientRect();
      let left = bounding.left;
      let right = bounding.right;
      let top = bounding.top;
      let bottom = bounding.bottom;
      const containingBlock = positionedContainingBlock(element);
      let reachedContainingBlock = containingBlock === undefined;

      for (
        let ancestor = element.parentElement;
        ancestor !== null;
        ancestor = ancestor.parentElement
      ) {
        if (ancestor === containingBlock) {
          reachedContainingBlock = true;
        }
        if (!reachedContainingBlock) {
          continue;
        }

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

    function clippedRect(element: Element): Rect | null {
      const rect = ancestorClippedRect(element);
      if (rect === null) {
        return null;
      }

      const left = Math.max(rect.left, 0);
      const right = Math.min(rect.right, document.documentElement.clientWidth);
      const top = Math.max(rect.top, 0);
      const bottom = Math.min(
        rect.bottom,
        document.documentElement.clientHeight,
      );
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0 || width * height < 1) {
        return null;
      }

      return {
        x: left,
        y: top,
        width,
        height,
        top,
        right,
        bottom,
        left,
      };
    }

    function isActionable(element: Element): boolean {
      if (!isRendered(element) || clippedRect(element) === null) {
        return false;
      }
      if (element.closest('[inert]') !== null) {
        return false;
      }
      if (
        (element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement) &&
        element.disabled
      ) {
        return false;
      }
      if (
        element.getAttribute('aria-disabled')?.trim().toLowerCase() === 'true'
      ) {
        return false;
      }
      if (getComputedStyle(element).pointerEvents === 'none') {
        return false;
      }

      const matchesWithoutTabIndex = element.matches(
        'a[href], button, input, select, textarea, [role="button"]',
      );
      const tabIndex = 'tabIndex' in element ? element.tabIndex : undefined;
      if (
        element.hasAttribute('tabindex') &&
        !matchesWithoutTabIndex &&
        (typeof tabIndex !== 'number' || tabIndex === -1)
      ) {
        return false;
      }

      return true;
    }

    function nearestHorizontalClippingAncestor(
      element: Element,
    ): Element | null {
      const containingBlock = positionedContainingBlock(element);
      let reachedContainingBlock = containingBlock === undefined;
      for (
        let ancestor = element.parentElement;
        ancestor !== null;
        ancestor = ancestor.parentElement
      ) {
        if (ancestor === containingBlock) {
          reachedContainingBlock = true;
        }
        if (!reachedContainingBlock) {
          continue;
        }
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

    function absoluteUrlToken(value: string): string {
      try {
        return new URL(value, document.baseURI).href;
      } catch {
        return value;
      }
    }

    function isAsciiWhitespace(value: string): boolean {
      return (
        value === '\u0009' ||
        value === '\u000a' ||
        value === '\u000c' ||
        value === '\u000d' ||
        value === '\u0020'
      );
    }

    function parseSrcset(value: string): string[] {
      const candidates: string[] = [];
      let position = 0;

      while (position < value.length) {
        while (
          position < value.length &&
          (isAsciiWhitespace(value[position] ?? '') || value[position] === ',')
        ) {
          position += 1;
        }
        if (position === value.length) {
          break;
        }

        const urlStart = position;
        while (
          position < value.length &&
          !isAsciiWhitespace(value[position] ?? '')
        ) {
          position += 1;
        }
        let url = value.slice(urlStart, position);

        if (url.endsWith(',')) {
          url = url.replace(/,+$/u, '');
          if (url !== '') {
            candidates.push(absoluteUrlToken(url));
          }
          continue;
        }

        while (
          position < value.length &&
          isAsciiWhitespace(value[position] ?? '')
        ) {
          position += 1;
        }
        const descriptorStart = position;
        let parentheses = 0;
        while (position < value.length) {
          const character = value[position];
          if (character === '(') {
            parentheses += 1;
          } else if (character === ')') {
            parentheses = Math.max(0, parentheses - 1);
          } else if (character === ',' && parentheses === 0) {
            break;
          }
          position += 1;
        }
        const descriptor = value.slice(descriptorStart, position).trim();
        if (value[position] === ',') {
          position += 1;
        }

        if (url !== '') {
          const absoluteUrl = absoluteUrlToken(url);
          candidates.push(
            descriptor === '' ? absoluteUrl : `${absoluteUrl} ${descriptor}`,
          );
        }
      }

      return candidates;
    }

    function pictureSources(image: HTMLImageElement): HTMLSourceElement[] {
      if (!(image.parentElement instanceof HTMLPictureElement)) {
        return [];
      }
      return [...image.parentElement.children].filter(
        (child): child is HTMLSourceElement =>
          child instanceof HTMLSourceElement && child.hasAttribute('srcset'),
      );
    }

    function hasImageCandidate(image: HTMLImageElement): boolean {
      return (
        image.hasAttribute('src') ||
        image.hasAttribute('srcset') ||
        pictureSources(image).length > 0
      );
    }

    function imageSourceCandidates(image: HTMLImageElement): string[] {
      const candidates = pictureSources(image).flatMap((source) =>
        parseSrcset(source.getAttribute('srcset') ?? ''),
      );
      if (image.hasAttribute('srcset')) {
        candidates.push(...parseSrcset(image.getAttribute('srcset') ?? ''));
      }
      if (image.hasAttribute('src')) {
        candidates.push(absoluteUrlToken(image.getAttribute('src') ?? ''));
      }
      return candidates;
    }

    function safeNaturalDimension(value: number): number {
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    }

    const viewportWidth = document.documentElement.clientWidth;
    // The DOM typing is non-null, but browsers may expose no body for non-HTML documents.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const bodyScrollWidth = document.body?.scrollWidth ?? 0;
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      bodyScrollWidth,
    );
    const offenders: { selector: string; rect: Rect }[] = [];

    if (documentWidth > viewportWidth + 1) {
      for (const element of document.querySelectorAll('*')) {
        if (!isRendered(element)) {
          continue;
        }

        const rect = ancestorClippedRect(element);
        if (
          rect === null ||
          (rect.left >= -1 && rect.right <= viewportWidth + 1)
        ) {
          continue;
        }

        const clippingAncestor = nearestHorizontalClippingAncestor(element);
        if (clippingAncestor !== null) {
          const overflowX = getComputedStyle(clippingAncestor).overflowX;
          const ancestorRect = ancestorClippedRect(clippingAncestor);
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

    const actionableSelector =
      'a[href], button, input, select, textarea, [role="button"], [tabindex]';
    const targets: { element: Element; rect: Rect }[] = [];
    const seenTargets = new Set<Element>();
    for (const element of document.querySelectorAll(actionableSelector)) {
      if (seenTargets.has(element)) {
        continue;
      }
      seenTargets.add(element);
      if (!isActionable(element)) {
        continue;
      }
      const rect = clippedRect(element);
      if (rect !== null) {
        targets.push({ element, rect });
      }
    }

    const overlays: { element: Element; rect: Rect }[] = [];
    for (const element of document.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      if (
        (style.position !== 'fixed' && style.position !== 'sticky') ||
        !isRendered(element) ||
        effectiveOpacity(element) <= 0.01 ||
        style.pointerEvents === 'none'
      ) {
        continue;
      }
      const rect = clippedRect(element);
      if (rect !== null) {
        overlays.push({ element, rect });
      }
    }

    function intersection(first: Rect, second: Rect): Rect | null {
      const left = Math.max(first.left, second.left);
      const right = Math.min(first.right, second.right);
      const top = Math.max(first.top, second.top);
      const bottom = Math.min(first.bottom, second.bottom);
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

    function pointHitsCover(
      x: number,
      y: number,
      cover: Element,
      target: Element,
    ): boolean {
      const hit = document.elementFromPoint(x, y);
      if (hit === null || hit === target || target.contains(hit)) {
        return false;
      }
      return hit === cover || cover.contains(hit);
    }

    const overlaps: OverlapSnapshot[] = [];
    for (const cover of overlays) {
      for (const target of targets) {
        if (
          cover.element === target.element ||
          cover.element.contains(target.element) ||
          target.element.contains(cover.element)
        ) {
          continue;
        }

        const overlapRect = intersection(cover.rect, target.rect);
        if (overlapRect === null) {
          continue;
        }
        const targetArea = target.rect.width * target.rect.height;
        const overlapRatio =
          (overlapRect.width * overlapRect.height) / targetArea;
        const centerCovered = pointHitsCover(
          target.rect.left + target.rect.width / 2,
          target.rect.top + target.rect.height / 2,
          cover.element,
          target.element,
        );
        let sampledHit = false;
        if (overlapRatio > 0.25) {
          for (const xFraction of [0.25, 0.5, 0.75]) {
            for (const yFraction of [0.25, 0.5, 0.75]) {
              if (
                pointHitsCover(
                  overlapRect.left + overlapRect.width * xFraction,
                  overlapRect.top + overlapRect.height * yFraction,
                  cover.element,
                  target.element,
                )
              ) {
                sampledHit = true;
                break;
              }
            }
            if (sampledHit) {
              break;
            }
          }
        }

        overlaps.push({
          coverSelector: diagnosticSelector(cover.element),
          targetSelector: diagnosticSelector(target.element),
          coverRect: rectValue(cover.rect),
          targetRect: rectValue(target.rect),
          overlapRatio,
          centerCovered,
          sampledHit,
        });
      }
    }

    const imageElements = [...document.querySelectorAll('img')].filter(
      (image) =>
        hasImageCandidate(image) &&
        isRendered(image) &&
        (clippedRect(image) !== null || image.loading !== 'lazy'),
    );
    const decodeRecords = imageElements.map((image) => {
      const record: {
        image: HTMLImageElement;
        decode: ImageSnapshot['decode'];
        completion: Promise<void>;
      } = {
        image,
        decode: 'timeout',
        completion: Promise.resolve(),
      };
      try {
        record.completion = image.decode().then(
          () => {
            record.decode = 'resolved';
          },
          () => {
            record.decode = 'rejected';
          },
        );
      } catch {
        record.decode = 'rejected';
      }
      return record;
    });

    if (decodeRecords.length > 0) {
      let timeoutId: number | undefined;
      await Promise.race([
        Promise.all(decodeRecords.map(({ completion }) => completion)),
        new Promise<void>((resolve) => {
          timeoutId = window.setTimeout(resolve, 2_000);
        }),
      ]);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    }

    const images: ImageSnapshot[] = decodeRecords.map(({ image, decode }) => ({
      selector: diagnosticSelector(image),
      currentSrc: image.currentSrc,
      sourceCandidates: imageSourceCandidates(image),
      complete: image.complete,
      naturalWidth: safeNaturalDimension(image.naturalWidth),
      naturalHeight: safeNaturalDimension(image.naturalHeight),
      decode,
    }));

    return {
      overflow: { viewportWidth, documentWidth, offenders },
      overlaps,
      images,
    };
  });

  function sanitizeCandidate(value: string): string {
    const descriptorIndex = value.search(/\s/u);
    if (descriptorIndex === -1) {
      return sanitizeUrl(value);
    }
    return `${sanitizeUrl(value.slice(0, descriptorIndex))}${value.slice(descriptorIndex)}`;
  }

  return {
    overflow: {
      viewportWidth: roundCss(snapshot.overflow.viewportWidth),
      documentWidth: roundCss(snapshot.overflow.documentWidth),
      offenders: snapshot.overflow.offenders.map(({ selector, rect }) => ({
        selector,
        rect: roundRect(rect),
      })),
    },
    overlaps: snapshot.overlaps,
    images: snapshot.images.map((image) => ({
      ...image,
      currentSrc: image.currentSrc === '' ? '' : sanitizeUrl(image.currentSrc),
      sourceCandidates: image.sourceCandidates.map(sanitizeCandidate),
    })),
  };
}
