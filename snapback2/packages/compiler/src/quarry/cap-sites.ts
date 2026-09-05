import type { SourceSite } from "../ir";
import type { QuarryVirtualModule } from "./index";
import { parseDocument } from "./parser";

// Schema admission runs in Rust even without operations. Preserve its constraint
// path in the existing compiler source map so the refusal points at the cap line.
export function capSites(virtual: QuarryVirtualModule, schema: Record<string, any>, sources: Record<string, SourceSite>): void {
  if (!virtual.authored.endsWith("/schema.q")) return;
  for (const table of parseDocument(virtual.authored, virtual.authoredSource).document.tables) {
    const constraints = schema.tables[table.name]?.constraints ?? [];
    for (const cap of table.caps) {
      const position = constraints.findIndex((c: any) => c.Cap?.max === cap.max && JSON.stringify(c.Cap.by) === JSON.stringify(cap.by));
      if (position >= 0) sources[`schema.tables.${table.name}.constraints[${position}]`] = cap.site;
    }
  }
}
