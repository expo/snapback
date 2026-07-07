// The generated allowlist as an ES module, single-sourced from allowlist.json
// (LLP 0048 §Handler-visible API surface). The Rust twin writes an equivalent
// module from the same JSON at runtime; the bundled Cloudflare/deploy build
// imports this committed one. esbuild resolves the JSON import at bundle time.
import data from '../allowlist.json';
export default data;
