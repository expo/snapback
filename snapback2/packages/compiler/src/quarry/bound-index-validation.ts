import { columnAt, componentLabel } from "../index-components";
import type { IndexDecl, Site } from "./ast";
import { typeError } from "./diagnostics";
import { siteText } from "./bound-source";

function totalRewrite(index: IndexDecl): string {
  const components = index.components
    .filter((component) => !("Column" in component && component.Column === "id"))
    .map(componentLabel);
  return `by ${index.name}: ${[...components, "id"].join(", ")}`;
}

export function validateCursorIndex(table: string, index: IndexDecl, keyCount: number, cursor?: Site): void {
  if (!cursor) return;
  if (keyCount >= index.components.length) typeError(cursor,
    `scan ${table}.${index.name} prefix names every index column, so a cursor has no position to compare`,
    "remove after or shorten the prefix");
  if (!index.unique && columnAt(index.components, -1) !== "id") typeError(index.site,
    `cursor at ${siteText(cursor)} uses ${table}.${index.name}, which is not a total order (it neither ends in id nor is unique)`,
    totalRewrite(index));
}

export function validatePageableMergeIndex(table: string, index: IndexDecl): void {
  if (columnAt(index.components, -1) !== "id") typeError(index.site,
    `pageable merge ${table}.${index.name} must end in intrinsic id`, totalRewrite(index));
}
