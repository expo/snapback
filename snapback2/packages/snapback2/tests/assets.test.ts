import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import {
  SnapbackRefusal,
  api,
  createClient,
  type AssetRecord,
} from "../dist/client.mjs";
import {
  AssetImage,
  AssetVideo,
  SnapbackProvider,
  useAssetUrl,
  useMutation,
} from "../dist/react.mjs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const image = { id: "s2id-00000000000000000000000000000006-0000000000000001", width: 640, height: 480 } as const;
const secondImage = { id: "s2id-00000000000000000000000000000006-0000000000000002", width: 320, height: 200 } as const;
const video = { id: "s2id-00000000000000000000000000000006-0000000000000003", width: 1280, height: 720, duration: 2_500 } as const;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function manifest(generation = "assets-v1", max = 16) {
  return {
    generation,
    programGeneration: "program-test",
    ops: {
      "assets.send": {
        kind: "mutation", planHash: "plan-test",
        args: {
          photo: { Image: { max } },
          optional: { Optional: { Image: { max } } },
          gallery: { List: { of: { Image: { max } }, max: 4 } },
          maybeGallery: { List: { of: { Optional: { Image: { max } } }, max: 4 } },
          clip: { Video: { max } },
        },
      },
    },
    channels: {},
    auth: {},
  };
}

test("mutation substitutes scalar, optional, list, and video sources from one manifest generation", async () => {
  const records: AssetRecord[] = [image, secondImage, image, video];
  let manifestCalls = 0;
  let uploads = 0;
  const contentLengths: string[] = [];
  let mutationBody: any;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      manifestCalls += 1;
      return json(manifest());
    }
    if (path === "/api/upload") {
      contentLengths.push(new Headers(init?.headers).get("Content-Length") ?? "");
      return json(records[uploads++]);
    }
    if (path === "/api/mutation") {
      mutationBody = JSON.parse(String(init?.body));
      return json({ state: "committed", seq: 9, data: mutationBody.args });
    }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });
  const args = {
    photo: new File(["a"], "photo.jpg", { type: "image/jpeg" }),
    optional: new File(["b"], "avatar.jpg", { type: "image/jpeg" }),
    gallery: [new File(["c"], "gallery.jpg", { type: "image/jpeg" })],
    clip: new File(["d"], "clip.mp4", { type: "video/mp4" }),
  };

  const result = await client.mutation(api.assets.send, args as any);

  assert.equal(result.state, "committed");
  assert.equal(manifestCalls, 2);
  assert.equal(uploads, 4);
  assert.deepEqual(contentLengths, ["1", "1", "1", "1"]);
  assert.deepEqual(mutationBody, {
    op: "assets.send",
    args: { photo: image, optional: secondImage, gallery: [image], clip: video },
  });
  assert.ok(args.photo instanceof File, "substitution must not mutate caller-owned arguments");
  client.close();
});

test("mixed records, Files, native URI sources, and optional list members substitute only manifest asset leaves", async () => {
  const uploadedRecords = [image, secondImage, image];
  const uploadLengths: string[] = [];
  let mutationBody: any;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json(manifest("mixed", 16));
    if (path === "/api/upload") {
      uploadLengths.push(new Headers(init?.headers).get("Content-Length") ?? "");
      return json(uploadedRecords[uploadLengths.length - 1]);
    }
    if (path === "/api/mutation") {
      mutationBody = JSON.parse(String(init?.body));
      return json({ state: "committed", seq: 10, data: null });
    }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });
  const result = await client.mutation(api.assets.send, {
    photo: new File(["p"], "photo.jpg"),
    optional: image,
    gallery: [secondImage, new File(["gg"], "gallery.jpg")],
    maybeGallery: [null, { uri: "data:application/octet-stream,n", fileSize: 1, mimeType: "image/jpeg" }],
    clip: video,
  } as any);

  assert.equal(result.state, "committed");
  assert.deepEqual(uploadLengths, ["1", "2", "1"]);
  assert.deepEqual(mutationBody.args, {
    photo: image,
    optional: image,
    gallery: [secondImage, secondImage],
    maybeGallery: [null, image],
    clip: video,
  });
  client.close();
});

async function assertStructuredUriPasses(
  operation: string,
  ref: any,
  descriptor: unknown,
  args: unknown,
): Promise<void> {
  let mutationArgs: unknown;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json({
      generation: "structured-uri-v1",
      programGeneration: "program-test",
      ops: { [operation]: { kind: "mutation", planHash: "plan-test", args: descriptor } },
      channels: {},
      auth: {},
    });
    if (path === "/api/mutation") {
      mutationArgs = JSON.parse(String(init?.body)).args;
      return json({ state: "committed", seq: 12, data: null });
    }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });

  const result = await client.mutation(ref, args as any);

  assert.equal(result.state, "committed");
  assert.deepEqual(mutationArgs, args);
  client.close();
}

test("a structured uri record passes through unchanged", async () => {
  await assertStructuredUriPasses(
    "links.open",
    api.links.open,
    { target: { uri: { Text: { max: 2048 } } } },
    { target: { uri: "https://example.com/article" } },
  );
});

test("a nested structured uri record passes through unchanged", async () => {
  await assertStructuredUriPasses(
    "posts.publish",
    api.posts.publish,
    { post: { link: { uri: { Text: { max: 2048 } } } } },
    { post: { link: { uri: "https://example.com/article" } } },
  );
});

test("a list of structured uri records passes through unchanged", async () => {
  await assertStructuredUriPasses(
    "links.openMany",
    api.links.openMany,
    { targets: { List: { of: { uri: { Text: { max: 2048 } } }, max: 4 } } },
    { targets: [{ uri: "https://example.com/one" }, { uri: "https://example.com/two" }] },
  );
});

test("mutation preflights every source before starting any upload", async () => {
  let uploads = 0;
  let mutations = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json(manifest("small", 1));
    if (path === "/api/upload") { uploads += 1; return json(image); }
    if (path === "/api/mutation") { mutations += 1; return json({ state: "committed", seq: 1, data: null }); }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });

  await assert.rejects(
    () => client.mutation(api.assets.send, {
      photo: new File(["a"], "okay.jpg"),
      optional: null,
      gallery: [new File(["too large"], "large.jpg")],
      clip: video,
    } as any),
    (error: unknown) => error instanceof SnapbackRefusal
      && error.code === "E_ASSET_TOO_LARGE"
      && error.envelope.family === "input",
  );
  assert.equal(uploads, 0);
  assert.equal(mutations, 0);
  client.close();
});

test("an upload refusal rejects the call and never invokes the mutation", async () => {
  let mutations = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json(manifest());
    if (path === "/api/upload") return json({
      code: "E_ASSET_TYPE",
      family: "input",
      message: "detected bytes are not an image",
      guide: "assets/upload",
    }, 415);
    if (path === "/api/mutation") { mutations += 1; return json({ state: "committed", seq: 1, data: null }); }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });

  await assert.rejects(
    () => client.mutation(api.assets.send, { photo: new File(["x"], "bad.jpg") } as any),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_ASSET_TYPE",
  );
  assert.equal(mutations, 0);
  client.close();
});

test("a second sibling upload refusal discards the first and sends no mutation", async () => {
  let uploads = 0;
  let mutations = 0;
  const discarded: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/uploads/discard") { discarded.push(JSON.parse(String(init?.body)).id); return json({ discarded: true }); }
    if (path === "/api/manifest") return json(manifest());
    if (path === "/api/upload" && ++uploads === 1) return json(image);
    if (path === "/api/upload") return json({
      code: "E_ASSET_TYPE",
      family: "input",
      message: "second sibling is not supported media",
      guide: "assets/upload",
    }, 415);
    if (path === "/api/mutation") { mutations += 1; return json({ state: "committed", seq: 1, data: null }); }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });

  await assert.rejects(
    () => client.mutation(api.assets.send, {
      photo: new File(["a"], "first.jpg"),
      gallery: [new File(["b"], "second.jpg")],
    } as any),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_ASSET_TYPE",
  );
  assert.equal(uploads, 2);
  assert.equal(mutations, 0);
  assert.deepEqual(discarded, [image.id]);
  client.close();
});

test("a browser File on a text argument refuses E_ASSET_TYPE with the argument path", async () => {
  let uploads = 0;
  let mutations = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json({
      generation: "links-v1",
      programGeneration: "program-test",
      ops: { "links.open": { kind: "mutation", planHash: "plan-test", args: { target: { Text: { max: 2048 } } } } },
      channels: {},
      auth: {},
    });
    if (path === "/api/upload") { uploads += 1; return json(image); }
    if (path === "/api/mutation") { mutations += 1; return json({ state: "committed", seq: 11, data: null }); }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });

  await assert.rejects(
    () => client.mutation(api.links.open, { target: new File(["x"], "x.txt") } as any),
    (error: unknown) => error instanceof SnapbackRefusal
      && error.code === "E_ASSET_TYPE"
      && error.message.includes("target"),
  );

  assert.equal(uploads, 0);
  assert.equal(mutations, 0);
  client.close();
});

test("a native URI source on a text argument refuses E_ASSET_TYPE with the argument path", async () => {
  let mutations = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json({
      generation: "links-v1",
      programGeneration: "program-test",
      ops: { "links.open": { kind: "mutation", planHash: "plan-test", args: { target: { Text: { max: 2048 } } } } },
      channels: {},
      auth: {},
    });
    if (path === "/api/mutation") { mutations += 1; return json({ state: "committed", seq: 11, data: null }); }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });

  await assert.rejects(
    () => client.mutation(api.links.open, { target: { uri: "file://x.txt", fileSize: 1 } } as any),
    (error: unknown) => error instanceof SnapbackRefusal
      && error.code === "E_ASSET_TYPE"
      && error.message.includes("target"),
  );

  assert.equal(mutations, 0);
  client.close();
});

test("a native URI source on an integer argument refuses E_ASSET_TYPE with the argument path", async () => {
  let mutations = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json({
      generation: "links-v1",
      programGeneration: "program-test",
      ops: { "links.open": { kind: "mutation", planHash: "plan-test", args: { target: { Int: {} } } } },
      channels: {},
      auth: {},
    });
    if (path === "/api/mutation") { mutations += 1; return json({ state: "committed", seq: 11, data: null }); }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });

  await assert.rejects(
    () => client.mutation(api.links.open, { target: { uri: "file://x.txt", fileSize: 1 } } as any),
    (error: unknown) => error instanceof SnapbackRefusal
      && error.code === "E_ASSET_TYPE"
      && error.message.includes("target"),
  );

  assert.equal(mutations, 0);
  client.close();
});

test("a server mutation refusal remains a resolved MutationRejected receipt", async () => {
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json(manifest());
    if (path === "/api/upload") return json(image);
    if (path === "/api/mutation") return json({
      state: "rejected",
      code: "E_OP_RULE",
      family: "op",
      message: "only members may send",
      guide: "op/rules",
    });
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });

  const result = await client.mutation(api.assets.send, { photo: new File(["x"], "photo.jpg") } as any);

  assert.equal(result.state, "rejected");
  assert.equal(result.code, "E_OP_RULE");
  client.close();
});

test("descriptor fence refuses an observed manifest generation change after uploads", async () => {
  let manifestCalls = 0;
  let mutations = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json(manifest(`generation-${++manifestCalls}`));
    if (path === "/api/upload") return json(image);
    if (path === "/api/mutation") { mutations += 1; return json({ state: "committed", seq: 1, data: null }); }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });

  await assert.rejects(
    () => client.mutation(api.assets.send, { photo: new File(["x"], "photo.jpg") } as any),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_ASSET_NOT_READY",
  );
  assert.equal(mutations, 0);
  client.close();
});

test("client.upload streams a fetchable URI with global fetch and never sends it to the owner fetch override", async () => {
  const progress: Array<{ loaded: number; total: number }> = [];
  let uploaded = "";
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (new URL(url).pathname === "/api/upload") {
      assert.equal(new Headers(init?.headers).get("Content-Length"), "5");
      uploaded = await new Response(init?.body as BodyInit).text();
      return json(video);
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });

  const record = await client.upload(
    { uri: "data:video/mp4,video", fileSize: 5, mimeType: "video/mp4" },
    { onProgress: (event) => progress.push(event) },
  );

  assert.deepEqual(record, video);
  assert.equal(uploaded, "video");
  assert.deepEqual(progress.at(0), { loaded: 0, total: 5 });
  assert.deepEqual(progress.at(-1), { loaded: 5, total: 5 });
  client.close();
});

test("client.upload verifies a requested kind against the server's sniffed record", async () => {
  const fetch = async (input: string | URL | Request) => {
    if (new URL(String(input)).pathname === "/api/upload") return json(video);
    throw new Error(`unexpected URL ${input}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });
  const source = () => new File(["clip"], "clip.mp4", { type: "video/mp4" });

  const clip = await client.upload(source(), { kind: "video" });
  assert.deepEqual(clip, video);
  await assert.rejects(
    () => client.upload(source(), { kind: "image" }),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_ASSET_TYPE"
      && error.message.includes("produced a video asset"),
  );
  client.close();
});

test("client.upload's kind check reads own properties only, so a polluted prototype cannot pass an image off as a video", async () => {
  const fetch = async (input: string | URL | Request) => {
    if (new URL(String(input)).pathname === "/api/upload") return json(image);
    throw new Error(`unexpected URL ${input}`);
  };
  const client = createClient({ url: "http://assets.test", as: "alice", fetch });
  (Object.prototype as any).duration = 2_500;
  try {
    await assert.rejects(
      () => client.upload(new File(["jpg"], "photo.jpg", { type: "image/jpeg" }), { kind: "video" }),
      (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_ASSET_TYPE"
        && error.message.includes("produced an image asset"),
    );
  } finally {
    delete (Object.prototype as any).duration;
  }
  client.close();
});

test("assetUrl rejects every request to put a carrier on an image URL", async () => {
  let carrierCalls = 0;
  const fetch = async (input: string | URL | Request) => {
    if (new URL(String(input)).pathname === "/api/auth/asset-session") {
      carrierCalls += 1;
      return json({ token: "must-not-mint", expiresAt: Date.now() + 120_000 });
    }
    throw new Error(`unexpected URL ${input}`);
  };
  const client = createClient({ url: "http://assets.test", token: "bearer", fetch });

  await assert.rejects(
    () => client.assetUrl(image, { carrier: true }),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_ASSET_CARRIER_IMAGE",
  );
  await assert.rejects(
    () => client.assetUrl(image, { download: true }),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_ASSET_CARRIER_IMAGE",
  );
  assert.equal(carrierCalls, 0);
  client.close();
});

test("assetUrl supports scalar/list widths and refreshes carriers only for new URLs", async () => {
  const originalNow = Date.now;
  let now = 2_000_000;
  let carriers = 0;
  Date.now = () => now;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/auth/asset-session") {
      carriers += 1;
      return json({ token: `carrier-${carriers}`, expiresAt: now + 120_000 });
    }
    throw new Error(`unexpected path ${path}`);
  };
  const client = createClient({ url: "http://assets.test/", token: "bearer", fetch });
  try {
    assert.equal(await client.assetUrl(image, { width: 64 }), `http://assets.test/api/asset/${image.id}?w=64`);
    assert.deepEqual(await client.assetUrl([image, video]), [
      `http://assets.test/api/asset/${image.id}`,
      `http://assets.test/api/asset/${video.id}`,
    ]);
    const first = await client.assetUrl(video, { download: true });
    assert.equal(first, `http://assets.test/api/asset/${video.id}?s=carrier-1`);
    assert.equal(await client.assetUrl(video, { carrier: true }), first);
    assert.equal(carriers, 1);
    now += 70_000;
    assert.equal(
      await client.assetUrl(video, { carrier: true }),
      `http://assets.test/api/asset/${video.id}?s=carrier-2`,
    );
    assert.equal(first, `http://assets.test/api/asset/${video.id}?s=carrier-1`);
  } finally {
    client.close();
    Date.now = originalNow;
  }
});

test("useAssetUrl and web asset components render in a DOM with the intended authority paths", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://app.test" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of [
    ["window", dom.window],
    ["document", dom.window.document],
    ["HTMLElement", dom.window.HTMLElement],
    ["HTMLImageElement", dom.window.HTMLImageElement],
    ["navigator", dom.window.navigator],
  ] as const) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  saved.set("ResizeObserver", Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver"));
  class TestResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(): void {
      this.callback([{ contentRect: { width: 120 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    disconnect(): void {}
    unobserve(): void {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });
  Object.defineProperty(dom.window, "devicePixelRatio", { configurable: true, value: 2 });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:asset-image";
  URL.revokeObjectURL = () => undefined;
  const assetFetches: Array<{ url: string; headers: Headers }> = [];
  let carrierCalls = 0;
  let mutationArgs: unknown;
  let send: { run(args: any): Promise<any> } | undefined;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/manifest") return json(manifest());
    if (url.pathname === "/api/auth/asset-session") {
      carrierCalls += 1;
      return json({ token: "dom-carrier", expiresAt: Date.now() + 120_000 });
    }
    if (url.pathname === "/api/upload") return json(image);
    if (url.pathname === "/api/mutation") {
      mutationArgs = JSON.parse(String(init?.body)).args;
      return json({ state: "committed", seq: 10, data: null });
    }
    if (url.pathname.startsWith("/api/asset/")) {
      assetFetches.push({ url: url.toString(), headers: new Headers(init?.headers) });
      return new Response(new Blob(["jpeg"], { type: "image/jpeg" }));
    }
    throw new Error(`unexpected path ${url.pathname}`);
  };
  function Harness() {
    send = useMutation(api.assets.send);
    const scalar = useAssetUrl(image, { width: 40 });
    const list = useAssetUrl([image, video]);
    const carried = useAssetUrl(video, { carrier: true });
    return React.createElement(React.Fragment, null,
      React.createElement("output", {
        "data-scalar": scalar,
        "data-list": list?.join("|"),
        "data-carried": carried,
      }),
      React.createElement(AssetImage, { asset: image, alt: "photo" }),
      React.createElement(AssetVideo, { asset: video, "aria-label": "clip" }),
    );
  }
  let root: Root | undefined;
  try {
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root!.render(React.createElement(
        SnapbackProvider,
        { url: "http://assets.test", as: "alice", fetch },
        React.createElement(Harness),
      ));
    });
    for (let attempt = 0; attempt < 20 && !dom.window.document.querySelector("img")?.getAttribute("src"); attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    const output = dom.window.document.querySelector("output")!;
    assert.equal(output.getAttribute("data-scalar"), `http://assets.test/api/asset/${image.id}?w=40`);
    assert.equal(output.getAttribute("data-list"), [
      `http://assets.test/api/asset/${image.id}`,
      `http://assets.test/api/asset/${video.id}`,
    ].join("|"));
    assert.equal(output.getAttribute("data-carried"), `http://assets.test/api/asset/${video.id}?s=dom-carrier`);
    const img = dom.window.document.querySelector("img")!;
    assert.equal(img.getAttribute("src"), "blob:asset-image");
    assert.equal(img.getAttribute("width"), "640");
    assert.equal(img.getAttribute("height"), "480");
    assert.equal(assetFetches.at(-1)?.url, `http://assets.test/api/asset/${image.id}?w=240`);
    assert.equal(assetFetches.at(-1)?.headers.get("X-Snapback-As"), "alice");
    const player = dom.window.document.querySelector("video")!;
    assert.equal(player.controls, true);
    assert.equal(player.src, `http://assets.test/api/asset/${video.id}?s=dom-carrier`);
    assert.equal(player.width, 1280);
    assert.equal(player.height, 720);
    assert.ok(carrierCalls >= 1);
    await act(async () => {
      const result = await send!.run({ photo: new File(["x"], "hook.jpg") });
      assert.equal(result.state, "committed");
    });
    assert.deepEqual(mutationArgs, { photo: image });
  } finally {
    if (root) await act(async () => root!.unmount());
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    dom.window.close();
  }
});

test("local serialization failure discards automatic uploads before any mutation request", async () => {
  const staged = new Map<string, number>();
  let uploads = 0;
  let mutations = 0;
  const client = createClient({ url: "http://assets.test", as: "alice", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json(manifest());
    if (path === "/api/upload") {
      uploads++;
      staged.set(image.id, Number(new Headers(init?.headers).get("Content-Length")));
      return json(image);
    }
    if (path === "/api/mutation") { mutations++; return json({ state: "committed", seq: 1, data: null }); }
    if (path === "/api/uploads/discard") return json({ discarded: staged.delete(JSON.parse(String(init?.body)).id) });
    throw new Error(`unexpected path ${path}`);
  } });
  const cyclic: any = {};
  cyclic.self = cyclic;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await assert.rejects(client.mutation(api.assets.send, {
        photo: new File(["a"], "photo.png"), metadata: cyclic,
      } as any), TypeError);
      assert.equal(staged.size, 0, "failed local submission must release staged objects and bytes");
    }
    assert.equal(uploads, 3);
    assert.equal(mutations, 0);
  } finally { client.close(); }
});

for (const status of [200, 422, 503]) {
  test(`automatic uploads are kept for an ambiguous HTTP ${status} mutation response`, async () => {
    let discards = 0;
    const client = createClient({ url: "http://assets.test", as: "alice", fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/manifest") return json(manifest());
      if (path === "/api/upload") return json(image);
      if (path === "/api/mutation") return new Response("lost response", { status });
      if (path === "/api/uploads/discard") { discards++; return json({ discarded: true }); }
      throw new Error(`unexpected path ${path}`);
    } });
    try {
      await assert.rejects(client.mutation(api.assets.send, { photo: new File(["a"], "photo.png") } as any));
      assert.equal(discards, 0);
    } finally { client.close(); }
  });
}

test("a definitive HTTP refusal discards only this call's upload, preserving supplied records", async () => {
  const discarded: string[] = [];
  const client = createClient({ url: "http://assets.test", as: "alice", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json(manifest());
    if (path === "/api/upload") return json(image);
    if (path === "/api/mutation") return json({ code: "E_INPUT", family: "input", message: "refused", guide: "quarry" }, 422);
    if (path === "/api/uploads/discard") { discarded.push(JSON.parse(String(init?.body)).id); return json({ discarded: true }); }
    throw new Error(`unexpected path ${path}`);
  } });
  try {
    await assert.rejects(client.mutation(api.assets.send, { photo: new File(["a"], "photo.png"), optional: secondImage } as any),
      (error: any) => error.code === "E_INPUT");
    assert.deepEqual(discarded, [image.id]);
  } finally { client.close(); }
});

test("cleanup session expiry preserves the already settled mutation rejection", async () => {
  const rejected = { state: "rejected", code: "E_REQUIRE:NOT_MEMBER", family: "rule", message: "membership required", guide: "quarry" };
  let discards = 0;
  const client = createClient({ url: "http://assets.test", token: "old-session", fetch: async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/auth/me") return json({ viewer: "alice", kind: "user" });
    if (path === "/api/manifest") return json(manifest());
    if (path === "/api/upload") return json(image);
    if (path === "/api/mutation") return json(rejected);
    if (path === "/api/uploads/discard") {
      discards++;
      return json({ code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth" }, 401);
    }
    throw new Error(`unexpected path ${path}`);
  } });
  try {
    assert.deepEqual(await client.mutation(api.assets.send, { photo: new File(["a"], "photo.png") } as any), rejected);
    assert.equal(discards, 1);
    assert.equal(client.snapshot.token, undefined, "cleanup still expires the invalid session");
  } finally { client.close(); }
});

for (const cleanupExpires of [false, true]) {
  test(`terminal mutation rejection discards with its bearer before expiry (cleanup expires: ${cleanupExpires})`, async () => {
    const rejected = { state: "rejected", code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth" };
    const staged = new Set<string>();
    let discards = 0;
    const client = createClient({ url: "http://assets.test", token: "session", fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/me") return json({ viewer: "alice", kind: "user" });
      if (path === "/api/manifest") return json(manifest());
      if (path === "/api/upload") { staged.add(image.id); return json(image); }
      if (path === "/api/mutation") return json(rejected);
      if (path === "/api/uploads/discard") {
        discards++;
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer session");
        if (cleanupExpires) return json(rejected, 401);
        return json({ discarded: staged.delete(JSON.parse(String(init?.body)).id) });
      }
      throw new Error(`unexpected path ${path}`);
    } });
    try {
      assert.deepEqual(await client.mutation(api.assets.send, { photo: new File(["a"], "photo.png") } as any), rejected);
      assert.equal(discards, 1);
      assert.equal(staged.size, cleanupExpires ? 1 : 0, "only refused cleanup leaves bytes for explicit recovery");
      assert.equal(client.snapshot.token, undefined);
      assert.equal(client.snapshot.lastRefusal?.code, "E_AUTH_SESSION");
    } finally { client.close(); }
  });
}

for (const stage of ["fetch", "body"] as const) {
  for (const mode of ["terminal", "replacement", "terminal-replacement"] as const) {
    test(`automatic cleanup bounds an ignored ${stage} abort during ${mode}`, async context => {
      const replacing = mode !== "terminal", terminal = mode !== "replacement";
      const rejected = { state: "rejected", code: terminal ? "E_AUTH_SESSION" : "E_REQUIRE:NOT_MEMBER",
        family: terminal ? "auth" : "rule", message: "refused", guide: "quarry" };
      const expired = { code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth" };
      let token: string | null = "session", cleanupSignal: AbortSignal | null | undefined;
      let begin!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { begin = resolve; });
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const saves: Array<string | null> = [];
      const flush = () => new Promise<void>(resolve => setImmediate(resolve));
      let mutationDone = false, replacementDone = false, result: unknown, failure: any, loginCalls = 0;
      let mutation: Promise<void> | undefined, replacement: Promise<unknown> | undefined;
      const client = createClient({ url: "http://assets.test", tokenStore: {
        load: () => token, save: value => { saves.push(value); token = value; },
      }, fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/auth/me") return json({ viewer: "alice", kind: "user" });
        if (path === "/api/auth/login") { loginCalls++; return json({ token: "successor", viewer: "bob", kind: "user" }); }
        if (path === "/api/manifest") return json(manifest());
        if (path === "/api/upload") return json(image);
        if (path === "/api/mutation") return json(rejected);
        if (path === "/api/uploads/discard") {
          assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer session");
          cleanupSignal = init?.signal;
          const response = json(expired, 401);
          if (stage === "body") response.json = async () => { begin(); await blocked; return expired; };
          else { begin(); await blocked; }
          return response;
        }
        throw new Error(`unexpected path ${path}`);
      } });
      try {
        await client.ready; await client.auth.me();
        context.mock.timers.enable({ apis: ["setTimeout"] });
        mutation = client.mutation(api.assets.send, { photo: new File(["a"], "photo.png") } as any)
          .then(value => { result = value; mutationDone = true; }, error => { failure = error; mutationDone = true; });
        await started;
        if (replacing) {
          replacement = client.auth.login({ email: "bob@example.com", password: "password" })
            .then(value => { replacementDone = true; return value; });
          void replacement.catch(() => undefined);
        }
        context.mock.timers.tick(1_999); await flush();
        assert.equal(mutationDone, false); assert.equal(loginCalls, 0);
        context.mock.timers.tick(1); await flush(); await flush();
        assert.equal(cleanupSignal?.aborted, true);
        assert.equal(mutationDone, true, "cleanup must settle while its obsolete fetch or body is still withheld");
        await mutation;
        if (terminal && replacing) assert.equal(failure?.code, "E_AUTH_SUPERSEDED");
        else { assert.equal(failure, undefined); assert.deepEqual(result, rejected); }
        if (replacing) {
          assert.equal(replacementDone, true, "auth replacement cannot remain behind timed-out cleanup");
          await replacement;
          assert.equal(token, "successor"); assert.equal(client.snapshot.auth.viewer, "bob");
        } else {
          assert.equal(token, null); assert.equal(client.snapshot.auth.state, "anonymous");
        }
        if (terminal) assert.ok(saves.includes(null), "terminal evidence clears captured durable custody");
        const snapshot = client.snapshot, saved = [...saves];
        release(); await flush(); await flush();
        assert.deepEqual(client.snapshot, snapshot, "late cleanup must not change successor auth or refusal state");
        assert.deepEqual(saves, saved, "late cleanup must not clear durable successor custody");
      } finally {
        release(); await Promise.allSettled([mutation, replacement]);
        await client.close(); context.mock.timers.reset();
      }
    });
  }
}

for (const stage of ["mutation", "first-upload", "direct-upload"] as const) {
  test(`owner-shaped ${stage} HTTP 401 clears custody after this call's cleanup`, async () => {
    const expired = { code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth" };
    let token: string | null = "session";
    const events: string[] = [];
    const client = createClient({ url: "http://assets.test", tokenStore: {
      load: () => token, save: value => { events.push(`save:${value}`); token = value; },
    }, fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/me") return json({ viewer: "alice", kind: "user" });
      if (path === "/api/manifest") return json(manifest());
      if (path === "/api/upload") return stage !== "mutation" ? json(expired, 401) : json(image);
      if (path === "/api/mutation") return json(expired, 401);
      if (path === "/api/uploads/discard") {
        events.push(`discard:${new Headers(init?.headers).get("Authorization")}`);
        return json({ discarded: true });
      }
      throw new Error(`unexpected path ${path}`);
    } });
    try {
      await client.ready; await client.auth.me();
      const source = new File(["a"], "photo.png");
      await assert.rejects(stage === "direct-upload" ? client.upload(source) : client.mutation(api.assets.send, { photo: source } as any),
        (error: any) => error.code === "E_AUTH_SESSION");
      assert.deepEqual(events, stage === "mutation" ? ["discard:Bearer session", "save:null"] : ["save:null"]);
      assert.equal(token, null); assert.equal(client.snapshot.auth.state, "anonymous");
    } finally { await client.close(); }
  });
}

for (const replacement of ["failed", "successful"] as const) {
  test(`XHR upload keeps terminal bearer evidence across ${replacement} login`, async context => {
    const originalXhr = globalThis.XMLHttpRequest;
    const expired = { code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth" };
    let begin!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const saves: Array<string | null> = [];
    let token: string | null = "session";
    class FakeXhr {
      upload = {}; status = 401; responseText = JSON.stringify(expired); onload!: () => void;
      open() {} setRequestHeader() {} getResponseHeader() { return "application/json"; }
      send() { release = () => this.onload(); begin(); }
    }
    globalThis.XMLHttpRequest = FakeXhr as any;
    context.mock.method(globalThis, "fetch", async (input: any) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/me") return json({ viewer: "alice", kind: "user" });
      if (path === "/api/auth/login") return replacement === "failed"
        ? json({ code: "E_AUTH_INVALID", family: "auth", message: "wrong password", guide: "auth" }, 401)
        : json({ token: "successor", viewer: "bob", kind: "user" });
      if (path === "/api/manifest") return json(manifest());
      throw new Error(`unexpected path ${path}`);
    });
    const client = createClient({ url: "http://assets.test", tokenStore: {
      load: () => token, save: value => { saves.push(value); token = value; },
    } });
    let upload: Promise<any> | undefined, login: Promise<any> | undefined;
    try {
      await client.ready; await client.auth.me();
      upload = client.upload(new File(["a"], "photo.png"), { onProgress() {} }).catch(error => error);
      await started;
      login = client.auth.login({ email: "bob@example.com", password: "password" }).catch(error => error);
      release();
      assert.equal((await upload).code, "E_AUTH_SUPERSEDED"); await login;
      assert.ok(saves.includes(null), "XHR terminal evidence clears captured custody despite supersession");
      assert.equal(token, replacement === "failed" ? null : "successor");
      assert.equal(client.snapshot.auth.state, replacement === "failed" ? "anonymous" : "authenticated");
    } finally { release?.(); await Promise.allSettled([upload, login]); await client.close(); globalThis.XMLHttpRequest = originalXhr; }
  });
}

for (const arm of ["assetBlob", "assetBytes"] as const) for (const stage of ["fetch", "body"] as const) {
  for (const replacement of ["failed", "successful"] as const) {
    test(`${arm} fences terminal ${stage} evidence after ${replacement} replacement`, async () => {
      let token: string | null = "session", begin!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { begin = resolve; });
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const expired = { code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth" };
      const client = createClient({ url: "http://assets.test", tokenStore: { load: () => token, save: value => { token = value; } },
        fetch: async input => {
          const path = new URL(String(input)).pathname;
          if (path === "/api/auth/me") return json({ viewer: "alice", kind: "user" });
          if (path === "/api/auth/login") return replacement === "failed"
            ? json({ code: "E_AUTH_INVALID", family: "auth", message: "invalid", guide: "auth" }, 401)
            : json({ token: "successor", viewer: "bob", kind: "user" });
          if (path === "/api/manifest") return json(manifest());
          if (path.startsWith("/api/asset/")) {
            const response = json(expired, 401);
            if (stage === "body") response.json = async () => { begin(); await blocked; return expired; };
            else { begin(); await blocked; }
            return response;
          }
          throw new Error(`unexpected path ${path}`);
        } });
      let read: Promise<any> | undefined;
      try {
        await client.ready; await client.auth.me();
        read = client[arm](`http://assets.test/api/asset/${image.id}`).catch(error => error);
        await started;
        await client.auth.login({ email: "bob@example.com", password: "password" }).catch(() => undefined);
        const snapshot = client.snapshot;
        release();
        assert.equal((await read).code, "E_AUTH_SUPERSEDED");
        assert.equal(token, replacement === "failed" ? null : "successor");
        if (replacement === "successful") assert.deepEqual(client.snapshot, snapshot, "late predecessor refusal cannot alter the successor");
        else assert.equal(client.snapshot.auth.state, "anonymous");
      } finally { release(); await read; await client.close(); }
    });
  }
}

for (const outcome of ["valid", "invalid"] as const) {
  test(`upload fences a delayed ${outcome} successful body before reporting it`, async () => {
    let begin!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const client = createClient({ url: "http://assets.test", token: "session", fetch: async input => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/me") return json({ viewer: "alice", kind: "user" });
      if (path === "/api/auth/login") return json({ token: "successor", viewer: "bob", kind: "user" });
      if (path === "/api/manifest") return json(manifest());
      if (path === "/api/upload") {
        const response = json(image);
        response.json = async () => { begin(); await blocked; if (outcome === "invalid") throw new SyntaxError("lost body"); return image; };
        return response;
      }
      throw new Error(`unexpected path ${path}`);
    } });
    let upload: Promise<any> | undefined, login: Promise<any> | undefined;
    try {
      await client.ready; await client.auth.me();
      upload = client.upload(new File(["a"], "photo.png")).catch(error => error); await started;
      login = client.auth.login({ email: "bob@example.com", password: "password" }); release();
      assert.equal((await upload).code, "E_AUTH_SUPERSEDED"); await login;
      assert.equal(client.snapshot.auth.viewer, "bob");
    } finally { release(); await Promise.allSettled([upload, login]); await client.close(); }
  });
}

for (const arm of ["assetBlob", "assetBytes"] as const) {
  test(`${arm} suppresses a successful byte body after successor custody is installed`, async () => {
    let begin!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const client = createClient({ url: "http://assets.test", token: "session", fetch: async input => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/me") return json({ viewer: "alice", kind: "user" });
      if (path === "/api/auth/login") return json({ token: "successor", viewer: "bob", kind: "user" });
      if (path === "/api/manifest") return json(manifest());
      const response = new Response("private bytes");
      if (arm === "assetBlob") response.blob = async () => { begin(); await blocked; return new Blob(["private bytes"]); };
      else response.arrayBuffer = async () => { begin(); await blocked; return new ArrayBuffer(4); };
      return response;
    } });
    let read: Promise<any> | undefined;
    try {
      await client.ready; await client.auth.me();
      read = client[arm](`http://assets.test/api/asset/${image.id}`).catch(error => error); await started;
      await client.auth.login({ email: "bob@example.com", password: "password" });
      const snapshot = client.snapshot;
      release(); assert.equal((await read).code, "E_AUTH_SUPERSEDED");
      assert.deepEqual(client.snapshot, snapshot);
    } finally { release(); await read; await client.close(); }
  });
}
