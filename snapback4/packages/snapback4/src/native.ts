// The device on a native host, reached from Node: `snapback4 device` as a
// process, one JSON line each way. Expo's module is `snapback4-expo`; the
// C ABI both speak is `crates/snapback4-device/include/snapback4.h`.

import type { Refusal } from "./contract.ts";
import type { DeviceOpener } from "./local.ts";

export type { DeviceCore, DeviceOpener } from "./local.ts";

export interface ProcessDeviceOptions {
  readonly dir: string;
  readonly binary?: string;
  readonly spawn?: (command: string, args: string[]) => { stdin: { write(text: string): unknown }; stdout: { on(event: "data", listener: (chunk: unknown) => void): unknown }; on?(event: "exit" | "error", listener: (...args: unknown[]) => void): unknown; kill(): unknown };
  readonly writeFile?: (path: string, text: string) => Promise<void>;
}

/** The device as a process for Node, with one store per client in `dir`.
 * Defaults resolve the CLI and load Node only when opening the device. */
// @ref LLP 3000.007#18.4 — require the stores' directory; share the CLI resolver and default to Node's host functions.
export function processDevice(options: ProcessDeviceOptions): DeviceOpener {
  if (!options || typeof options.dir !== "string" || options.dir.trim().length === 0) throw new Error("processDevice needs { dir }: the directory its stores live in");
  const { dir, binary: suppliedBinary, spawn: suppliedSpawn, writeFile: suppliedWriteFile } = options;
  return {
    async open(name, backend) {
      const binary = suppliedBinary ?? (await import("./resolve-binary.ts")).resolveBinary();
      const spawn = suppliedSpawn ?? (await import("node:child_process")).spawn;
      const writeFile = suppliedWriteFile ?? (async (path: string, text: string) => {
        const { mkdir, writeFile } = await import("node:fs/promises");
        const { dirname } = await import("node:path");
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text);
      });
      const path = `${dir.replace(/\/$/, "")}/${name}.sqlite`;
      const args = [ "device", path ];
      if (backend) {
        const file = `${path}.backend.json`;
        await writeFile(file, JSON.stringify(backend));
        args.push(file);
      }
      const child = spawn(binary, args);
      let buffer = "";
      let failure: Error | undefined;
      let closed = false;
      let closing: Promise<void> | undefined;
      const lines: string[] = [];
      const waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
      const fail = (error: Error) => {
        failure ??= error;
        for (const waiter of waiting.splice(0)) waiter.reject(failure);
      };
      const exited = new Promise<void>((resolve) => {
        if (!child.on) { resolve(); return; }
        child.on("exit", (code, signal) => { fail(new Error(`native device exited (${signal ?? code})`)); resolve(); });
        child.on("error", (error) => { fail(error instanceof Error ? error : new Error(String(error))); resolve(); });
      });
      child.stdout.on("data", (chunk) => {
        buffer += String(chunk);
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          const waiter = waiting.shift();
          if (waiter) waiter.resolve(line);
          else lines.push(line);
        }
      });
      const next = () => new Promise<string>((resolve, reject) => {
        if (failure) reject(failure);
        else if (lines.length) resolve(lines.shift()!);
        else waiting.push({ resolve, reject });
      });
      try {
        const opened = JSON.parse(await next()) as { ok?: unknown; denied?: Refusal };
        if (opened.denied) throw new Error(`${opened.denied.code}: ${opened.denied.message}`);
      } catch (error) { child.kill(); await exited; throw error; }
      let chain: Promise<unknown> = Promise.resolve();
      return {
        call(request) {
          if (closed || failure) return Promise.reject(failure ?? new Error("native device is closed"));
          const answer = chain.then(async () => {
            const encoded = `${JSON.stringify(request)}\n`;
            const line = next();
            void line.catch(() => {});
            try { child.stdin.write(encoded); }
            catch (error) { fail(error instanceof Error ? error : new Error(String(error))); throw error; }
            return JSON.parse(await line) as Record<string, unknown>;
          });
          chain = answer.catch(() => undefined);
          return answer;
        },
        close() {
          if (closing) return closing;
          closed = true;
          closing = (async () => { await chain; child.kill(); await exited; })();
          return closing;
        },
      };
    },
  };
}
