import { startServer, type ServerContext, type ServerOptions } from "../../src/server.ts";
import type { Mutation, Query, Read, Write } from "../../src/contract.ts";

const read = { kind: "query", name: "read" } as Query<{ id: string }, { text: string }>;
const save = { kind: "mutation", name: "save" } as Mutation<{ text: string }, { id: string }>;

async function handler(args: { id: string }, ctx: ServerContext<"MODEL_KEY">): Promise<{ summary: string }> {
  const secret: string = ctx.secrets.MODEL_KEY;
  // @ts-expect-error undeclared secrets are absent from the generated context
  ctx.secrets.BILLING_KEY;
  // @ts-expect-error secrets cannot be reassigned
  ctx.secrets.MODEL_KEY = "replacement";
  const source: Read<{ text: string }> = await ctx.query(read, args);
  // @ts-expect-error query arguments come from the declared operation
  await ctx.query(read, { other: "id" });
  const write: Write<{ id: string }> = await ctx.mutate(save, { text: secret }, { id: ctx.writeIdFor("save") });
  if (write.state === "sent" && write.replayed !== true) {
    const id: string = write.result.id;
    void id;
  }
  const step: { text: string } = await ctx.step("model", args, key => ({ text: key }), { reconcile: key => ({ text: key }) });
  void source;
  return { summary: step.text };
}

function noSecrets(ctx: ServerContext) {
  // @ts-expect-error no declared secrets means no readable secret properties
  return ctx.secrets.MODEL_KEY;
}

export function generatedServerShape(options: ServerOptions) {
  // @ts-expect-error generated servers always use the bounded registry protocol
  options.actionRegistry;
  void noSecrets;
  return startServer({ actions: { summarize: { contract: "v1", secrets: ["MODEL_KEY"] } }, effects: {} }, { actions: { summarize: handler } }, options);
}
