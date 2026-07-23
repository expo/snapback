// Ambient types for the @snapback/vite virtual module (LLP 0030): the
// relative relay base path plus sanitized dev state — never a backend origin,
// admin token, or token-file path.
declare module 'virtual:snapback/dev' {
  export const snapbackBasePath: string;
  export const snapbackDevState: {
    mode: string;
    shape: string | null;
    ready: boolean;
    basePath: string;
  };
  const facts: { snapbackBasePath: string; snapbackDevState: typeof snapbackDevState };
  export default facts;
}
