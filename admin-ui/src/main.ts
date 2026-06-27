// Entry shim: exactVitePlugin's served-app build needs a subdir entry
// (a root-level /main.ts can't locate its route registry). The real boot is
// one level up.
import '../main.ts';
