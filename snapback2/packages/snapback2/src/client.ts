function notBuilt(name: string): (...args: unknown[]) => never {
  return () => {
    throw Object.assign(new Error(`snapback2/client ${name} is not built yet`), { code: "E_NOT_BUILT" });
  };
}

export const api = notBuilt("api");
export const createClient = notBuilt("createClient");
