import type { Site } from "./ast";
import type { BoundSourceStack, BoundType } from "./bound-model";

export function typeName(type: BoundType): string {
  if (type.kind === "empty-list") return "[]";
  if (type.kind === "ref") return type.table;
  if (type.kind === "row") return `${type.table.name} row`;
  if (type.kind === "money") return `money ${type.currency} ${type.scale}`;
  if (type.kind === "decimal") return `decimal ${type.scale}`;
  if (type.kind === "image" || type.kind === "video") return `${type.kind} asset`;
  if (type.kind === "list") return `[${typeName(type.item)}] <=${type.max}`;
  if (type.kind === "collection") return `bounded collection <=${type.max}`;
  return type.kind;
}

export function sourceStack(site: Site, use?: Site): BoundSourceStack {
  const definition = withoutExpansion(site);
  const expandedUse = use ?? site.expandedFrom;
  return expandedUse ? { definition, use: withoutExpansion(expandedUse) } : { definition };
}

export function withoutExpansion(site: Site): Site {
  const { expandedFrom: _expandedFrom, expansionId: _expansionId, ...authored } = site;
  return authored;
}

export function siteText(site: Site): string { return `${site.file}:${site.line}:${site.col}`; }
