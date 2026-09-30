import { lazy, Suspense } from "react";

const backend = import.meta.env.VITE_BACKEND ?? "snapback4";
const BackendApp = lazy(() => backend === "convex"
  ? import("./backends/convex").then(module => ({ default: module.ConvexApp }))
  : backend === "supabase"
    ? import("./backends/supabase").then(module => ({ default: module.SupabaseApp }))
    : import("./backends/snapback4").then(module => ({ default: module.SnapbackApp })));

export function App() { return <Suspense fallback={<p>Opening tracker…</p>}><BackendApp /></Suspense>; }
