import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { walk } from "../expo-project.mjs";

/** Also detect payloads in an HTTP-cache database or a remuxed player temp file. */
function payloads(bytes) {
  const needles = [Buffer.from(bytes)];
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  for (let at = png ? 8 : 0; at + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8);
    const length = png ? size + 12 : size;
    if (length < 8 || at + length > bytes.length) break;
    if (type === "IDAT" || type === "mdat") needles.push(bytes.subarray(at + 8, at + 8 + (png ? size : size - 8)));
    at += length;
  }
  return needles.filter((bytes) => bytes.length > 8);
}
export async function assertNoMediaOnDisk(container, forbidden) {
  const media = forbidden.map(({ id, bytes }) => ({ id, needles: payloads(Buffer.from(bytes)) }));
  for (const path of await walk(container)) {
    let content;
    try { content = await readFile(path); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    for (const { id, needles } of media) {
      assert.ok(!path.includes(id), `view-once asset filename on disk: ${path}`);
      assert.ok(!needles.some((bytes) => content.includes(bytes)), `view-once asset ${id} bytes on disk: ${path}`);
    }
  }
}
