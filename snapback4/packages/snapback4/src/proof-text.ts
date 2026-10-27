// @ref LLP 3000.011.003.000.000#17-wave-29-serve-proofs-and-proof-residue-dx12 — scroll unique reachable candidates; hidden descendants never manufacture evidence.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Locator, FrameLocator, Selectors } from "playwright-core";

export const renderedSelector = `sb4rendered${randomUUID().replaceAll("-", "")}`;
const registrations = new WeakMap<Selectors, Promise<void>>();
let selectorReady: Promise<void> = Promise.resolve();
export async function registerRenderedSelector(selectors: Selectors): Promise<void> {
  let registration = registrations.get(selectors);
  if (!registration) {
    registration = selectors.register(renderedSelector, { content: renderedTextSource() }, { contentScript: true });
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
    const clips: { box: DOMRect; x: boolean; y: boolean; dx: [number, number]; dy: [number, number] }[] = [];
    let scrollCoupled = true;
    for (let element = parent(node); element; element = parent(element)) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.opacity === "0" || style.contentVisibility === "hidden") return "";
      if (style.position === "fixed" || style.position === "sticky") scrollCoupled = false;
      const clipsOverflow = style.display !== "contents" && style.display !== "inline";
      const x = clipsOverflow && style.overflowX !== "visible", y = clipsOverflow && style.overflowY !== "visible";
      // Root overflow propagates to the viewport. A non-scrolling body box
      // (Expo web) must not clip descendants that the document can scroll to.
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyPropagates = rootStyle.overflowX === "visible" && rootStyle.overflowY === "visible";
      const rootOverflow = element === document.documentElement || (element === document.body && bodyPropagates);
      if ((x || y) && !rootOverflow) {
        let box = element.getBoundingClientRect();
        const html = element as HTMLElement;
        let scaleX = 1, scaleY = 1;
        if (typeof html.offsetWidth === "number") {
          scaleX = html.offsetWidth ? box.width / html.offsetWidth : 1;
          scaleY = html.offsetHeight ? box.height / html.offsetHeight : 1;
          // Quirks-mode BODY.clientHeight names the viewport even when
          // this body's overflow is an ordinary element clip.
          const width = Math.min(html.clientWidth, Math.max(0, html.offsetWidth - html.clientLeft - parseFloat(style.borderRightWidth || "0")));
          const height = Math.min(html.clientHeight, Math.max(0, html.offsetHeight - html.clientTop - parseFloat(style.borderBottomWidth || "0")));
          box = new DOMRect(box.left + html.clientLeft * scaleX, box.top + html.clientTop * scaleY, width * scaleX, height * scaleY);
        }
        const scrollX = scrollCoupled && /^(auto|scroll)$/.test(style.overflowX) && html.clientWidth > 0;
        const scrollY = scrollCoupled && /^(auto|scroll)$/.test(style.overflowY) && html.clientHeight > 0;
        const maxX = Math.max(0, html.scrollWidth - html.clientWidth), maxY = Math.max(0, html.scrollHeight - html.clientHeight);
        const rtl = style.direction === "rtl";
        clips.push({ box, x, y,
          dx: scrollX ? [(html.scrollLeft - (rtl ? 0 : maxX)) * scaleX, (html.scrollLeft + (rtl ? maxX : 0)) * scaleX] : [0, 0],
          dy: scrollY ? [(html.scrollTop - maxY) * scaleY, html.scrollTop * scaleY] : [0, 0] });
      }
    }
    if (scrollCoupled) {
      const root = document.scrollingElement ?? document.documentElement;
      const rootStyle = getComputedStyle(document.documentElement);
      const style = rootStyle.overflowX === "visible" && rootStyle.overflowY === "visible" ? getComputedStyle(document.body) : rootStyle;
      const canScrollX = style.overflowX !== "clip", canScrollY = style.overflowY !== "clip";
      clips.push({box:new DOMRect(0, 0, document.documentElement.clientWidth, document.documentElement.clientHeight), x:true, y:true,
        dx:canScrollX ? [root.scrollLeft - Math.max(0,root.scrollWidth-root.clientWidth),root.scrollLeft] : [0,0],
        dy:canScrollY ? [root.scrollTop - Math.max(0,root.scrollHeight-root.clientHeight),root.scrollTop] : [0,0]});
    }
    if (!scrollCoupled) clips.push({ box: new DOMRect(0, 0, document.documentElement.clientWidth, document.documentElement.clientHeight), x: true, y: true, dx: [0, 0], dy: [0, 0] });
    // Compose legal scroll movement and clips from the nearest ancestor out.
    // This accepts an inner scrollport behind an outer real clip, but cannot
    // manufacture text positioned before the scrollable origin.
    const visible = (rect: DOMRect) => {
      let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
      if (right <= left || bottom <= top) return false;
      for (const {box,x,y,dx,dy} of clips) {
        left += dx[0]; right += dx[1]; top += dy[0]; bottom += dy[1];
        if (x) { left = Math.max(left,box.left); right = Math.min(right,box.right); }
        if (y) { top = Math.max(top,box.top); bottom = Math.min(bottom,box.bottom); }
        if (right <= left || bottom <= top) return false;
      }
      return true;
    };
    const range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()];
    if (!rects.some(visible)) return "";
    if (rects.every(rect => visible(new DOMRect(rect.left, rect.top, Math.min(0.01, rect.width), Math.min(0.01, rect.height)))
      && visible(new DOMRect(rect.right - Math.min(0.01, rect.width), rect.bottom - Math.min(0.01, rect.height), Math.min(0.01, rect.width), Math.min(0.01, rect.height))))) return text;
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
    const options = JSON.parse(selector) as { source: string; flags: string; regex: boolean; exact: boolean; control?: boolean };
    const regex = options.regex ? new RegExp(options.source, options.flags) : null;
    const needle = options.source.replace(/\s+/g, " ").trim();
    const found: Element[] = [];
    const matches = (text: string) => {
      if (!text) return false;
      if (regex) { regex.lastIndex = 0; return regex.test(text); }
      return options.exact ? text === needle : text.toLowerCase().includes(needle.toLowerCase());
    };
    if (options.control) {
      const labelText = (label: HTMLLabelElement): string => {
        const clone = label.cloneNode(true) as Element;
        for (const control of clone.querySelectorAll("input, select, textarea, button, [aria-hidden='true']")) control.remove();
        return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
      };
      const controls = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")];
      return controls.filter(control => !control.getAttribute("aria-label")?.trim() && !control.getAttribute("aria-labelledby")?.trim()
        && matches([...(control.labels ?? [])].map(labelText).join(" ")));
    }
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

// tsx/esbuild may insert __name into nested functions. Supply that helper in
// the serialized lexical scope, never in the app's global or selector world.
function renderedTextSource(): string {
  return `(() => { const __name = (target, _name) => target; return (${renderedTextEngine.toString()})(); })()`;
}

export function visibleText(locator: Locator, timeout: number): Promise<string> {
  // Build the function in Node, then let Playwright serialize it. Passing an
  // arrow as a string would evaluate to the function rather than invoke it.
  const reader = new Function("element", `return (${renderedTextSource()}).text(element);`) as (element: Element) => string;
  return locator.evaluate(reader, undefined, { timeout });
}

// Reuse the rendered-text engine in the page, including visibility and clipping.
// No selector internals, application globals or injected DOM markers are needed.
export async function armFreshText(locator: Locator, previous: string | null, timeoutMs: number) {
  const reader = new Function("element", "previous", `
    const engine = ${renderedTextSource()};
    let timer;
    const state = { text: null, stop: () => { observer.disconnect(); clearTimeout(timer); } };
    const roots = new Set();
    const observe = root => {
      if (roots.has(root)) return;
      roots.add(root);
      observer.observe(root, { subtree:true, childList:true, characterData:true, attributes:true });
    };
    const descendants = root => {
      for (const child of root.querySelectorAll('*')) if (child.shadowRoot) {
        observe(child.shadowRoot); descendants(child.shadowRoot);
      }
    };
    const inspect = () => {
      if (!element.isConnected || state.text) return;
      if (element.shadowRoot) { observe(element.shadowRoot); descendants(element.shadowRoot); }
      descendants(element);
      const text = engine.text(element);
      if (text && text !== previous) state.text = text;
    };
    const observer = new MutationObserver(inspect);
    observe(element.ownerDocument);
    let root = element.getRootNode();
    while (root && root !== element.ownerDocument) {
      observe(root); root = root.host?.getRootNode();
    }
    if (element.shadowRoot) { observe(element.shadowRoot); descendants(element.shadowRoot); }
    descendants(element);
    timer = setTimeout(state.stop, ${timeoutMs});
    inspect();
    return state;
  `) as (element: Element, previous: string | null) => {text: string | null; stop: () => void};
  const element = await locator.elementHandle({timeout: timeoutMs});
  if (!element) throw Error("E_PROOF_USAGE: trigger observation requires a stable element");
  try { return await element.evaluateHandle(reader, previous); }
  finally { await element.dispose(); }
}

// @ref LLP 3000.011.003.000.000#18-proof-command-startup-lat3 — process-only proofs do not load the browser peer.
// Keep locator construction synchronous for CommonJS and caller-owned pages.
// Actions below still await registration, including on already-open pages.
let defaultRegistrationStarted = false;
function registerDefaultSelector(): void {
  if (defaultRegistrationStarted) return;
  defaultRegistrationStarted = true;
  try { void registerRenderedSelector(createRequire(import.meta.url)("playwright-core").selectors).catch(() => {}); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND" && (error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error; }
}

// Locator construction stays synchronous for CommonJS callers. Actions wait
// for optional-peer selector registration, including when the page predates
// the proof import. Preserve synchronous Locator/FrameLocator chaining.
export const scopedLocators = new WeakSet<object>();
const locatorWrappers = new WeakMap<object, object>();
const locatorChains = new Set(["locator", "filter", "describe", "first", "last", "nth", "and", "or", "frameLocator", "contentFrame", "owner"]);
export function registeredLocator<T extends Locator | FrameLocator>(locator: T): T {
  registerDefaultSelector();
  const known = locatorWrappers.get(locator);
  if (known) return known as T;
  const wrapped = new Proxy(locator, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function" || key === "constructor") return value;
      if (typeof key !== "string" || key === "page" || key === "toString" || key === "_inspect" || key === "_equals") return value.bind(target);
      if (locatorChains.has(key) || key.startsWith("getBy")) return (...args: unknown[]) => {
        const next = registeredLocator(Reflect.apply(value, target, args));
        if (scopedLocators.has(wrapped) || scopedLocators.has(target)) scopedLocators.add(next);
        return next;
      };
      return (...args: unknown[]) => selectorReady.then(async () => {
        if (["count", "isVisible", "innerText", "textContent", "evaluate"].includes(key) && "count" in target) {
          const candidate = target as Locator;
          if (await candidate.count() === 1) await candidate.scrollIntoViewIfNeeded({timeout:1000});
        }
        return Reflect.apply(value, target, args);
      });
    },
  });
  locatorWrappers.set(locator, wrapped); locatorWrappers.set(wrapped, wrapped);
  return wrapped;
}
