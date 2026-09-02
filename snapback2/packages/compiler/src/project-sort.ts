import type { Program } from "./ir";

export function sortSerdeMaps(program: Program): Program {
  return {
    ...program,
    args: Object.fromEntries(Object.entries(program.args).sort(([left], [right]) => left.localeCompare(right))),
    body: sortNestedMaps(program.body) as Program["body"],
  };
}

function sortNestedMaps(value: unknown, mapValue = false): unknown {
  if (Array.isArray(value)) return value.map((item) => sortNestedMaps(item));
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>);
  const ordered = mapValue ? entries.sort(([left], [right]) => left.localeCompare(right)) : entries;
  return Object.fromEntries(ordered.map(([key, item]) => [key, sortNestedMaps(item, ["Object", "Row", "Map"].includes(key))]));
}
