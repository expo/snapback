import { effect } from "snapback2";

export const witness = effect({
  grants: ["http://127.0.0.1"],
  run: async (payload: { body: string; url: string }, tools) => {
    const text = payload.body.substring(0, 80);
    const i = 0;
    const headers = new Headers({ "X-Test": "one" });
    headers.append("x-test", "two");
    headers.set("another", "three");
    headers.delete("another");
    const entries = Array.from(headers);
    const response = await fetch(payload.url);
    const responseChecks = response.ok && response.status === 200 && response.url === payload.url
      && !response.redirected && response.headers.get("content-type") === "text/plain" && !response.bodyUsed;
    const bytes = await response.arrayBuffer();
    const jsonResponse = await tools.fetch(new URL(payload.url), { redirect: "error" });
    const parsed = await jsonResponse.json();
    const textResponse = await fetch(payload.url);
    const body = await textResponse.text();
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    const key = {};
    const url = new URL("/path?a=1", "https://example.com");
    const params = new URLSearchParams("x=1");
    params.append("x", "2");
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, 7);
    return {
      strings: text === "hello" && text.charAt(1) === "e" && text[i] === "h" && "7".padStart(2, "0") === "07",
      Array: Array.from([1, 2]).length === 2,
      ArrayBuffer: bytes instanceof ArrayBuffer && bytes.byteLength === 11,
      BigInt: BigInt(7).toString() === "7",
      BigInt64Array: new BigInt64Array([BigInt(7)])[0] === BigInt(7),
      BigUint64Array: new BigUint64Array([BigInt(7)])[0] === BigInt(7),
      Boolean: Boolean(text),
      DataView: view.getInt32(0) === 7,
      Date: new Date(0).toISOString() === "1970-01-01T00:00:00.000Z" && Date.now() > 0,
      Error: new Error("x").message === "x",
      EvalError: new EvalError("x").message === "x",
      Float32Array: new Float32Array([7])[0] === 7,
      Float64Array: new Float64Array([7])[0] === 7,
      Headers: headers.has("X-Test") && entries[0][0] === "x-test" && entries[0][1] === "one, two"
        && headers.get("another") === null && new Headers(headers).get("X-Test") === "one, two",
      Infinity: Infinity > 1,
      Int16Array: new Int16Array([7])[0] === 7,
      Int32Array: new Int32Array([7])[0] === 7,
      Int8Array: new Int8Array([7])[0] === 7,
      Intl: new Intl.NumberFormat("en-US").format(7) === "7",
      JSON: JSON.parse(JSON.stringify({ x: 7 })).x === 7,
      Map: new Map([["x", 7]]).get("x") === 7,
      Math: Math.max(1, 7) === 7,
      NaN: Number.isNaN(NaN),
      Number: Number.isFinite(7) && !Number.isFinite(Infinity),
      Object: Object.entries({ x: 7 })[0][1] === 7,
      Promise: await Promise.resolve(true),
      Proxy: new Proxy({ x: 7 }, { get: (target, property) => Reflect.get(target, property) }).x === 7,
      RangeError: new RangeError("x").message === "x",
      ReferenceError: new ReferenceError("x").message === "x",
      Reflect: Reflect.ownKeys({ x: 7 })[0] === "x",
      RegExp: new RegExp("^h").test(text),
      Set: new Set([1, 1, 7]).size === 2,
      String: String.fromCharCode(65) === "A",
      Symbol: typeof Symbol("x") === "symbol",
      SyntaxError: new SyntaxError("x").message === "x",
      TextDecoder: new TextDecoder().decode(bytes) === '{"ok":true}',
      TextEncoder: new TextEncoder().encode("hello")[0] === 104,
      TypeError: new TypeError("x").message === "x",
      URIError: new URIError("x").message === "x",
      URL: url.origin === "https://example.com" && url.searchParams.get("a") === "1",
      URLSearchParams: params.getAll("x").join(",") === "1,2",
      Uint16Array: new Uint16Array([7])[0] === 7,
      Uint32Array: new Uint32Array([7])[0] === 7,
      Uint8Array: new Uint8Array(bytes)[0] === 123,
      Uint8ClampedArray: new Uint8ClampedArray([999])[0] === 255,
      WeakMap: new WeakMap([[key, 7]]).get(key) === 7,
      WeakSet: new WeakSet([key]).has(key),
      atob: atob("aGk=") === "hi",
      btoa: btoa("hi") === "aGk=",
      console: console.log("witness") === undefined && console.info("info") === undefined
        && console.debug("debug") === undefined && console.warn("warn") === undefined && console.error("error") === undefined,
      decodeURI: decodeURI("https://example.com/a%20b") === "https://example.com/a b",
      decodeURIComponent: decodeURIComponent("a%2Fb") === "a/b",
      encodeURI: encodeURI("https://example.com/a b") === "https://example.com/a%20b",
      encodeURIComponent: encodeURIComponent("a/b") === "a%2Fb",
      escape: escape(" ") === "%20",
      fetch: responseChecks && response.bodyUsed && parsed.ok && body === '{"ok":true}',
      isFinite: isFinite(7) && !isFinite(Infinity),
      isNaN: isNaN(NaN),
      meta: meta.id === "language-1" && meta.attempt === 1 && meta.effect === "provider.witness"
        && tools.meta.id === meta.id && tools.meta.attempt === meta.attempt && tools.meta.effect === meta.effect,
      parseFloat: parseFloat("7.5") === 7.5,
      parseInt: parseInt("17", 10) === 17,
      setTimeout: true,
      unescape: unescape("%20") === " ",
      undefined: undefined === void 0,
    };
  },
});
