import type { SnapbackClient } from "./client";

export declare function journey(name: string, body: (context: {
  as(name: string): SnapbackClient;
  tick(ms: number): Promise<Record<string, unknown>>;
  url: string;
}) => void | Promise<void>): void;
