/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly COTERIE_PROVIDER?: string;
}

// The source-linked @exact packages include Bun-executable scripts that read
// `import.meta.main`; this app's explicit `types` list excludes bun-types,
// so declare the property here for typechecking.
interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly main?: boolean;
}
