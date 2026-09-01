import type { QuarryDiagnostic, Site } from "./ast";

export class QuarryError extends Error {
  readonly diagnostic: QuarryDiagnostic;

  constructor(site: Site, message: string) {
    super(message);
    this.diagnostic = { ...site, message };
  }
}

export function refuse(site: Site, message: string): never {
  throw new QuarryError(site, message);
}

export function formatDiagnostic(item: QuarryDiagnostic): string {
  return `${item.file}:${item.line}:${item.col} — ${item.message}`;
}
