// @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — hidden descendants cannot manufacture rendered evidence.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Locator, FrameLocator, Selectors } from "playwright-core";

export const renderedSelector = `sb4rendered${randomUUID().replaceAll("-", "")}`;
const registrations = new WeakMap<Selectors, Promise<void>>();
let selectorReady: Promise<void> = Promise.resolve();
export async function registerRenderedSelector(selectors: Selectors): Promise<void> {
  let registration = registrations.get(selectors);
  if (!registration) {
    registration = selectors.register(renderedSelector, renderedTextEngine, { contentScript: true });
    registrations.set(selectors, registration);
    selectorReady = Promise.all([selectorReady, registration]).then(() => {});
    void selectorReady.catch(() => {}); // Observations await and surface this rejection.
  }
  await registration;
}

// Playwright serializes this function into its isolated selector world. Keep it
// self-contained: no application script, global callback or injected DOM marker.
function renderedTextEngine() {
  let observedText = "";
  const parent = (node: Node): Element | null => (node as Element).assignedSlot ?? node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null;
  function textInView(node: Node): string {
    const text = node.textContent ?? "";
    if (!text) return "";
    const clips: { box: DOMRect; x: boolean; y: boolean }[] = [];
    for (let element = parent(node); element; element = parent(element)) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.opacity === "0" || style.contentVisibility === "hidden") return "";
      const clipsOverflow = style.display !== "contents" && style.display !== "inline";
      const x = clipsOverflow && style.overflowX !== "visible", y = clipsOverflow && style.overflowY !== "visible";
      if (x || y) {
        let box = element.getBoundingClientRect();
        const html = element as HTMLElement;
        if (typeof html.offsetWidth === "number") {
          const scaleX = html.offsetWidth ? box.width / html.offsetWidth : 1;
          const scaleY = html.offsetHeight ? box.height / html.offsetHeight : 1;
          box = new DOMRect(box.left + html.clientLeft * scaleX, box.top + html.clientTop * scaleY, html.clientWidth * scaleX, html.clientHeight * scaleY);
        }
        clips.push({ box, x, y });
      }
    }
    const visible = (rect: DOMRect) => {
      let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
      for (const {box,x,y} of clips) {
        if (x) { left = Math.max(left,box.left); right = Math.min(right,box.right); }
        if (y) { top = Math.max(top,box.top); bottom = Math.min(bottom,box.bottom); }
      }
      return right > left && bottom > top;
    };
    const range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()];
    if (!rects.some(visible)) return "";
    if (rects.every(rect => clips.every(({box,x,y}) => (!x || rect.left >= box.left && rect.right <= box.right) && (!y || rect.top >= box.top && rect.bottom <= box.bottom)))) return text;
    // A clipped prefix must not claim the hidden suffix. Range geometry also
    // works through display:contents and wrappers with visible overflow.
    let result = "", offset = 0;
    for (const character of text) {
      range.setStart(node,offset); offset += character.length; range.setEnd(node,offset);
      if ([...range.getClientRects()].some(visible)) result += character;
    }
    return result;
  }
  function queryAll(root: Document | Element | ShadowRoot, selector: string): Element[] {
    const options = JSON.parse(selector) as { source: string; flags: string; regex: boolean; exact: boolean };
    const regex = options.regex ? new RegExp(options.source, options.flags) : null;
    const needle = options.source.replace(/\s+/g, " ").trim();
    const found: Element[] = [];
    const matches = (text: string) => {
      if (!text) return false;
      if (regex) { regex.lastIndex = 0; return regex.test(text); }
      return options.exact ? text === needle : text.toLowerCase().includes(needle.toLowerCase());
    };
    const walk = (node: Node, ancestorSuppressed = false): { text: string; matched: boolean } => {
      if (node.nodeType === Node.TEXT_NODE) return { text: ancestorSuppressed ? "" : textInView(node), matched: false };
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return { text: "", matched: false };
      const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : null;
      if (element && (/^(INPUT|TEXTAREA|SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(element.tagName) || element.isContentEditable)) return { text: "", matched: false };
      const style = element ? getComputedStyle(element) : null;
      if (style?.display === "none" || style?.opacity === "0") return { text: "", matched: false };
      const suppressed = style ? style.visibility === "hidden" || style.visibility === "collapse" : ancestorSuppressed;
      const nodes = element?.shadowRoot ? element.shadowRoot.childNodes
        : element?.tagName === "SLOT" ? ((element as HTMLSlotElement).assignedNodes({flatten:true}).length ? (element as HTMLSlotElement).assignedNodes({flatten:true}) : element.childNodes) : node.childNodes;
      let text = "", descendantMatch = false;
      for (const child of nodes) {
        const result = walk(child, suppressed);
        // Block boundaries are whitespace, never concatenated words from
        // unrelated paragraph siblings. Inline RN spans retain their text.
        const block = child.nodeType === Node.ELEMENT_NODE && /^(block|flex|grid|table|list-item)/.test(getComputedStyle(child as Element).display);
        text += block ? ` ${result.text} ` : result.text;
        descendantMatch ||= result.matched;
      }
      const normalized = text.replace(/\s+/g, " ").trim();
      const box = element?.getBoundingClientRect();
      const visible = element && !suppressed && box && box.width > 0 && box.height > 0;
      const ownMatch = !!visible && !/^(HTML|BODY)$/.test(element.tagName) && matches(normalized);
      if (ownMatch && !descendantMatch) found.push(element);
      return { text, matched: ownMatch || descendantMatch };
    };
    observedText = walk(root).text.replace(/\s+/g, " ").trim();
    return found;
  }
  return { queryAll, query: (root: Document | Element | ShadowRoot, selector: string) => queryAll(root, selector)[0] ?? null,
    text: (root: Element) => { queryAll(root, '{"source":"","flags":"","regex":false,"exact":true}'); return observedText; } };
}

export function visibleText(locator: Locator, timeout: number): Promise<string> {
  // Build the function in Node, then let Playwright serialize it. Passing an
  // arrow as a string would evaluate to the function rather than invoke it.
  const reader = new Function("element", `return (${renderedTextEngine.toString()})().text(element);`) as (element: Element) => string;
  return locator.evaluate(reader, undefined, { timeout });
}

// Optional peer: CLI/process helpers still import and run when it is absent.
// Keep this graph synchronously require-able. Registration starts during import;
// withBrowser awaits that same promise before creating its context. Caller-owned
// browsers finish asynchronous launch before running a selector.
try { void registerRenderedSelector(createRequire(import.meta.url)("playwright-core").selectors).catch(() => {}); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND" && (error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error; }

// Locator construction stays synchronous for CommonJS callers. Actions wait
// for optional-peer selector registration, including when the page predates
// the proof import. Preserve synchronous Locator/FrameLocator chaining.
const locatorWrappers = new WeakMap<object, object>();
const locatorChains = new Set(["locator", "filter", "describe", "first", "last", "nth", "and", "or", "frameLocator", "contentFrame", "owner"]);
export function registeredLocator<T extends Locator | FrameLocator>(locator: T): T {
  const known = locatorWrappers.get(locator);
  if (known) return known as T;
  const wrapped = new Proxy(locator, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function" || key === "constructor") return value;
      if (typeof key !== "string" || key === "page" || key === "toString" || key === "_inspect" || key === "_equals") return value.bind(target);
      if (locatorChains.has(key) || key.startsWith("getBy")) return (...args: unknown[]) => registeredLocator(Reflect.apply(value, target, args));
      return (...args: unknown[]) => selectorReady.then(() => Reflect.apply(value, target, args));
    },
  });
  locatorWrappers.set(locator, wrapped); locatorWrappers.set(wrapped, wrapped);
  return wrapped;
}
