// @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — hidden descendants cannot manufacture rendered evidence.
import { randomUUID } from "node:crypto";
import type { Locator, Selectors } from "playwright-core";

export const renderedSelector = `sb4rendered${randomUUID().replaceAll("-", "")}`;
const registrations = new WeakMap<Selectors, Promise<void>>();
export async function registerRenderedSelector(selectors: Selectors): Promise<void> {
  let registration = registrations.get(selectors);
  if (!registration) {
    registration = selectors.register(renderedSelector, renderedTextEngine, { contentScript: true });
    registrations.set(selectors, registration);
  }
  await registration;
}

// Playwright serializes this function into its isolated selector world. Keep it
// self-contained: no application script, global callback or injected DOM marker.
function renderedTextEngine() {
  let observedText = "";
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
      if (node.nodeType === Node.TEXT_NODE) return { text: ancestorSuppressed ? "" : node.textContent ?? "", matched: false };
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
// Await registration before exposing the synchronous locator constructor.
try { await registerRenderedSelector((await import("playwright-core")).selectors); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND" && (error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error; }
