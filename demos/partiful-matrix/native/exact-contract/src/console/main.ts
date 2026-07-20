// The Exact Vite plugin serves this project-local entry at /__exact/console.
// The scaffold source-links Exact already; reuse the canonical console rather
// than silently serving a Vite error overlay when the shared native host asks
// for its debug surface.
import '../../../../../../../exact/js/src/console/main.ts';
