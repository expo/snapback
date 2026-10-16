import { startServer } from "snapback4/server";
// Compile-time assertions consume the real generated server modules and SDK.
import { server as mixed, type Routes, type Actions, manifest } from "./mixed.ts";
import { server as empty } from "./empty.ts";
import { server as actionOnly } from "./action-only.ts";
import { server as routeOnly } from "./route-only.ts";

const actions: Actions = { send(_args, ctx) {
  const key: string = ctx.secrets.ACTION_KEY;
  // @ts-expect-error Route secrets do not enter an action's context.
  ctx.secrets.BILLING_KEY;
  void key;
  return {};
} };
const routes: Routes = {
  async session(req, ctx) {
    const method: "POST" = req.method;
    const bytes: Uint8Array = await req.rawBody();
    const headers: Headers = req.headers;
    const key: string = ctx.secrets.SESSION_KEY;
    // @ts-expect-error Service route secrets are scoped to that route.
    ctx.secrets.BILLING_KEY;
    // @ts-expect-error A3 has no SQL context.
    ctx.sql;
    void method; void bytes; void headers; void key;
    return new Response(null, { status: 204 });
  },
  provider: {
    async verify(req, ctx) {
      const bytes: Uint8Array = await req.rawBody();
      const key: string = ctx.secrets.BILLING_KEY;
      const signal: AbortSignal = ctx.signal;
      // @ts-expect-error Verification cannot access the delegated database.
      ctx.mutate;
      // @ts-expect-error Verification cannot access action secrets.
      ctx.secrets.ACTION_KEY;
      // @ts-expect-error Declared secrets are readonly.
      ctx.secrets.BILLING_KEY = "replacement";
      void bytes; void key; void signal;
      return true;
    },
    handle(req, ctx) {
      const key: string = ctx.secrets.BILLING_KEY;
      const principal: string = ctx.principal;
      void req; void key; void principal;
      return new Response(null, { status: 204 });
    },
  },
  ["__proto__"]: () => new Response(),
};

mixed(startServer, { actions, routes, effects: { notify: async () => null } });
// @ts-expect-error Declared actions cannot be omitted when routes are present.
mixed(startServer, { routes });
// @ts-expect-error Declared routes cannot be omitted when actions are present.
mixed(startServer, { actions });
// @ts-expect-error Every declared route needs a handler.
const missing: Routes = { session: routes.session, provider: routes.provider };
// @ts-expect-error Provider routes require a verifier and a handler.
const bypass: Routes["provider"] = (_req, _ctx) => new Response();
// @ts-expect-error Verification must explicitly return boolean.
const invalidVerifier: Routes["provider"]["verify"] = () => "yes";
// @ts-expect-error A plain JSON object is not a route Response.
const invalidResponse: Routes["session"] = () => ({ accepted: true });
// @ts-expect-error Unknown route keys do not publish a handler.
mixed(startServer, { actions, routes: { ...routes, extra: () => new Response() } });

empty(startServer, {});
empty(startServer, { actions: {}, routes: {}, effects: {} });
// @ts-expect-error An empty action registry accepts no handler.
empty(startServer, { actions: { invented: () => ({}) } });
// @ts-expect-error An empty route registry accepts no handler.
empty(startServer, { routes: { invented: () => new Response() } });
// @ts-expect-error An empty effect registry accepts no handler.
empty(startServer, { effects: { invented: async () => null } });
actionOnly(startServer, { actions: { send: () => ({}) } });
// @ts-expect-error The action-only server still requires its action.
actionOnly(startServer, {});
// @ts-expect-error An action-only server cannot add an undeclared route.
actionOnly(startServer, { actions: { send: () => ({}) }, routes: { invented: () => new Response() } });
routeOnly(startServer, { routes: { session: () => new Response() } });
// @ts-expect-error Route-only servers require their declared route.
routeOnly(startServer, {});
// @ts-expect-error A route-only server cannot add an undeclared action.
routeOnly(startServer, { routes: { session: () => new Response() }, actions: { invented: () => ({}) } });
const method: "POST" = manifest.routes.provider.method;
const service: "service:billing" = manifest.routes.provider.service;
const session: null = manifest.routes.session.service;
void method; void service; void session; void missing; void bypass; void invalidVerifier; void invalidResponse;
