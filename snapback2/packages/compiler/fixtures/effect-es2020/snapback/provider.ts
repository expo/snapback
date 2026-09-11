import { effect } from "snapback2";

export const witness = effect({
  grants: ["http://127.0.0.1"],
  run: async (payload: { body: string; url: string }, tools) => {
    const text = payload.body.substring(0, 80);
    const i = 0;
    const headers = new Headers({ "X-Test": "one" });
    headers.append("x-test", "two");
    headers.set("another", "three");
    const headerSet = headers.get("another") === "three";
    headers.delete("another");
    const entries = Array.from(headers);
    const headerVisits: string[] = [];
    const headerContext = { tag: "headers" };
    headers.forEach(function (this: {tag: string}, value, name, owner) {
      headerVisits.push(`${this.tag}:${name}:${value}:${owner === headers}`);
    }, headerContext);
    const response = await fetch(payload.url);
    const responseChecks = response.ok && response.status === 200 && response.url === payload.url
      && !response.redirected && response.headers.get("content-type") === "text/plain" && !response.bodyUsed;
    const bytes = await response.arrayBuffer();
    const jsonResponse = await tools.fetch(new URL(payload.url), { redirect: "error" });
    const parsed = await jsonResponse.json();
    const textResponse = await fetch(payload.url);
    const body = await textResponse.text();
    let timerFired = false;
    let timerHandle = 0;
    await new Promise<void>((resolve) => {
      timerHandle = setTimeout((label: string, count: number) => {
        timerFired = label === "delivered" && count === 7;
        resolve();
      }, 1, "delivered", 7);
    });
    let defaultTimerFired = false;
    await new Promise<void>((resolve) => setTimeout(() => { defaultTimerFired = true; resolve(); }));
    const key = {};
    const url = new URL("/path?a=1", "https://example.com");
    const params = new URLSearchParams("x=1");
    params.append("x", "2");
    params.append("a", "3");
    params.sort();
    const sortedParams = params.toString() === "a=3&x=1&x=2" && params.size === 3;
    const paramVisits: string[] = [];
    params.forEach(function (this: {tag: string}, value, name, owner) {
      paramVisits.push(`${this.tag}:${name}:${value}:${owner === params}`);
    }, { tag: "params" });
    const paramIterators = JSON.stringify(Array.from(params.entries())) === '[["a","3"],["x","1"],["x","2"]]'
      && Array.from(params.keys()).join(",") === "a,x,x" && Array.from(params.values()).join(",") === "3,1,2"
      && JSON.stringify(Array.from(params)) === JSON.stringify(Array.from(params.entries()));
    const paramHas = params.has("x") && params.has("x", "2") && !params.has("x", "9") && params.get("absent") === null;
    params.delete("x", "2");
    const valueDeleted = params.getAll("x").join(",") === "1";
    params.delete("a");
    params.set("x", "4");
    const paramMutations = valueDeleted && !params.has("a") && params.get("x") === "4" && params.size === 1;
    const editedUrl = new URL(url);
    editedUrl.href = "https://first.example/start";
    const hrefSet = editedUrl.href === "https://first.example/start";
    editedUrl.protocol = "http:";
    editedUrl.username = "user";
    editedUrl.password = "pass";
    editedUrl.host = "second.example:81";
    const hostSet = editedUrl.host === "second.example:81";
    editedUrl.hostname = "third.example";
    editedUrl.port = "82";
    editedUrl.pathname = "/next";
    editedUrl.search = "?q=one";
    editedUrl.hash = "#end";
    const urlFields = hrefSet && hostSet && editedUrl.protocol === "http:" && editedUrl.username === "user"
      && editedUrl.password === "pass" && editedUrl.host === "third.example:82" && editedUrl.hostname === "third.example"
      && editedUrl.port === "82" && editedUrl.pathname === "/next" && editedUrl.search === "?q=one" && editedUrl.hash === "#end"
      && editedUrl.origin === "http://third.example:82" && editedUrl.href === "http://user:pass@third.example:82/next?q=one#end";
    editedUrl.searchParams.set("q", "two");
    const urlView = editedUrl.search === "?q=two" && editedUrl.toString() === editedUrl.href && editedUrl.toJSON() === editedUrl.href;
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
      Headers: headerSet && headers.has("X-Test") && entries[0][0] === "x-test" && entries[0][1] === "one, two"
        && headers.get("another") === null && new Headers(headers).get("X-Test") === "one, two"
        && new Headers([["X-Pair", "four"]]).get("x-pair") === "four" && Array.from(new Headers()).length === 0
        && JSON.stringify(Array.from(headers.entries())) === JSON.stringify(entries)
        && Array.from(headers.keys()).join(",") === "x-test" && Array.from(headers.values()).join(",") === "one, two"
        && headerVisits.join("|") === "headers:x-test:one, two:true",
      Infinity: Infinity > 1,
      Int16Array: new Int16Array([7])[0] === 7,
      Int32Array: new Int32Array([7])[0] === 7,
      Int8Array: new Int8Array([7])[0] === 7,
      Intl: Number(new Intl.NumberFormat("en-US").format(7)) === 7,
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
      TextDecoder: new TextDecoder().decode(bytes) === '{"ok":true}' && new TextDecoder().decode() === ""
        && new TextDecoder().decode(new Uint8Array([104, 105])) === "hi"
        && new TextDecoder().decode(new DataView(new Uint8Array([104, 105]).buffer)) === "hi",
      TextEncoder: new TextEncoder().encode("hello")[0] === 104 && new TextEncoder().encode().length === 0,
      TypeError: new TypeError("x").message === "x",
      URIError: new URIError("x").message === "x",
      URL: url.origin === "https://example.com" && url.searchParams.get("a") === "1" && urlFields && urlView
        && new URL("/relative", url).href === "https://example.com/relative"
        && URL.canParse("https://example.com") && URL.canParse(url) && URL.canParse("/relative", url)
        && !URL.canParse("not a url") && URL.parse("not a url") === null
        && URL.parse(url)?.href === url.href && URL.parse("/relative", "https://example.com")?.pathname === "/relative",
      URLSearchParams: sortedParams && paramIterators && paramHas && paramMutations
        && paramVisits.join("|") === "params:a:3:true|params:x:1:true|params:x:2:true"
        && new URLSearchParams(params).toString() === "x=4" && new URLSearchParams().size === 0
        && new URLSearchParams([["x", "1"]]).get("x") === "1" && new URLSearchParams({x: "1"}).get("x") === "1",
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
      setTimeout: timerFired && defaultTimerFired && typeof timerHandle === "number",
      unescape: unescape("%20") === " ",
      undefined: undefined === void 0,
    };
  },
});
