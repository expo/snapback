// Builds the Snapback cap reveal into a single self-contained page.
//   node brand/cap/build.mjs           -> website/public/cap/index.html
// The page is one file on purpose: it is served as a static asset and embedded
// in the homepage with an <iframe>, so it must not depend on the site bundle.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "website", "public", "cap", "index.html");
const b64 = (f) => readFileSync(join(here, "assets", f)).toString("base64");

let html = readFileSync(join(here, "cap.template.html"), "utf8");
const slots = {
  "/*__THREE__*/": () => readFileSync(join(here, "assets", "three.bundle.js"), "utf8"),
  "__WORDMARK_B64__": () => b64("wordmark-white.png"),
  "__EXPOWORD_B64__": () => b64("expo-word-white.png"),
  "__CLOTH_B64__": () => b64("cloth-albedo.png"),
};
for (const [slot, load] of Object.entries(slots)) {
  if (!html.includes(slot)) throw new Error("template is missing " + slot);
  html = html.replace(slot, load);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log("built " + out + "  " + (html.length / 1024).toFixed(0) + "KB");
