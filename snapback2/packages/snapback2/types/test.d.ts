import type { Api } from "./client";

export type JourneyClient = {
  query<Args, Result>(op: { readonly __args: Args; readonly __result: Result }, args: Args): Promise<{ state: string; data: Result; seq: number }>;
  mutation<Args, Result>(op: { readonly __args: Args; readonly __result: Result }, args: Args): Promise<{ state: string; data: Result; seq: number }>;
};
export declare function journey(name: string, body: (context: {
  as(name: string): JourneyClient;
  tick(ms: number): Promise<Record<string, unknown>>;
  url: string;
  api?: Api;
}) => void | Promise<void>): void;
