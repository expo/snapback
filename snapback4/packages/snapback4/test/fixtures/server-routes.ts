import { startServer, type RouteHandler, type ServiceRoute, type ServerOptions } from "../../src/server.ts";

const session: RouteHandler<"SESSION_KEY"> = async (request, ctx) => {
  const bytes: Uint8Array = await request.rawBody();
  const method: "POST" = request.method;
  const signature: string | null = request.headers.get("x-signature");
  const secret: string = ctx.secrets.SESSION_KEY;
  // @ts-expect-error undeclared secret
  ctx.secrets.HOOK_KEY;
  void method; void signature; void secret; void bytes;
  return new Response(null, { status: 204 });
};

const provider: ServiceRoute<"HOOK_KEY"> = {
  async verify(request, ctx) {
    const secret: string = ctx.secrets.HOOK_KEY;
    const bytes: Uint8Array = await request.rawBody();
    // @ts-expect-error verifier has no database authority
    ctx.query;
    // @ts-expect-error verifier has no mutation authority
    ctx.mutate;
    // @ts-expect-error verifier has no durable invocation yet
    ctx.invocation;
    // @ts-expect-error undeclared secret
    ctx.secrets.SESSION_KEY;
    // @ts-expect-error secret scopes are readonly
    ctx.secrets.HOOK_KEY = "replacement";
    return !ctx.signal.aborted && secret.length > 0 && bytes.length > 0;
  },
  async handle(request, ctx) {
    const id: string = ctx.writeIdFor("save");
    const secret: string = ctx.secrets.HOOK_KEY;
    void id; void secret; void request;
    return new Response("accepted");
  },
};

// @ts-expect-error a handler returns Response, not a JSON result
const invalidHandler: RouteHandler = () => ({ ok: true });
// @ts-expect-error verification returns an exact boolean
const invalidVerifier: ServiceRoute["verify"] = () => "true";

const manifest = { actions: {}, effects: {}, routes: {
  session: { contract: "v1", method: "POST", path: "/session", service: null, secrets: ["SESSION_KEY"] },
  provider: { contract: "v1", method: "POST", path: "/provider", service: "service:provider", secrets: ["HOOK_KEY"] },
} } as const;

export function generatedRoutesShape(options: ServerOptions) {
  void invalidHandler; void invalidVerifier;
  return startServer(manifest, { routes: { session, provider } }, options);
}
