// A jsdom window installed on globalThis for React component tests, with object
// URL accounting: every blob: URL minted and every one revoked is recorded, so a
// test can prove a lifetime, not only a render.
import { act } from "react";
import { JSDOM } from "jsdom";

export interface DomEnvironment {
  dom: JSDOM;
  /** blob: URLs in minting order (`blob:test-1`, `blob:test-2`, …). */
  created: string[];
  revoked: string[];
  restore(): void;
}

class TestResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) { this.callback = callback; }
  observe(): void { this.callback([{ contentRect: { width: 120 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
  disconnect(): void {}
  unobserve(): void {}
}

export function domEnvironment(url = "http://assets.test/"): DomEnvironment {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  install("window", dom.window);
  install("document", dom.window.document);
  install("HTMLElement", dom.window.HTMLElement);
  install("HTMLImageElement", dom.window.HTMLImageElement);
  install("navigator", dom.window.navigator);
  install("ResizeObserver", TestResizeObserver);
  Object.defineProperty(dom.window, "devicePixelRatio", { configurable: true, value: 2 });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const created: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = () => {
    const minted = `blob:test-${created.length + 1}`;
    created.push(minted);
    return minted;
  };
  URL.revokeObjectURL = (value: string) => { revoked.push(value); };
  return {
    dom,
    created,
    revoked,
    restore() {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      dom.window.close();
    },
  };
}

/** Lets React effects and the client's promises settle, `ticks` × 10 ms, inside `act`. */
export async function settle(ticks = 1): Promise<void> {
  for (let tick = 0; tick < ticks; tick += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

/** Polls a condition through `act` ticks; false when it never held. */
export async function until(condition: () => boolean, attempts = 60): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return true;
    await settle();
  }
  return condition();
}
