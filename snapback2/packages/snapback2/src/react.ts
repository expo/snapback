function notBuilt(name: string): (...args: unknown[]) => never {
  return () => {
    throw Object.assign(new Error(`snapback2/react ${name} is not built yet`), { code: "E_NOT_BUILT" });
  };
}

export const SnapbackProvider = notBuilt("SnapbackProvider");
export const DevOverlay = notBuilt("DevOverlay");
export const useQuery = notBuilt("useQuery");
export const useMutation = notBuilt("useMutation");
