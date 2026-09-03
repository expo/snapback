import type { Expr } from "./ast";

type NarrowingType = { kind: string; optional?: boolean; nullable?: boolean };
type NarrowingBinding = {
  type: NarrowingType;
  narrowedType?: NarrowingType;
  narrowedFields?: Set<string>;
};

// @ref LLP 1011#b4-narrowing-on-if-x--null — the fact lives on the cloned
// binding identity. Rebinding installs a fresh object and therefore drops it.
export function narrowThenBindings<T extends NarrowingBinding>(condition: Expr, bindings: Map<string, T>): void {
  if (condition.kind !== "binary" || condition.op !== "!="
    || condition.right.kind !== "literal" || condition.right.value !== null) return;
  const target = condition.left;
  if (target.kind === "name") {
    const binding = bindings.get(target.name);
    if (!binding) return;
    const current = binding.narrowedType ?? binding.type;
    if ("optional" in current && current.optional) binding.narrowedType = { ...current, optional: false };
    else if ("nullable" in current && current.nullable) binding.narrowedType = { ...current, nullable: false };
    return;
  }
  if (target.kind !== "member" || target.base.kind !== "name") return;
  const binding = bindings.get(target.base.name);
  const current = binding?.narrowedType ?? binding?.type;
  if (!binding || current?.kind !== "row") return;
  binding.narrowedFields = new Set(binding.narrowedFields);
  binding.narrowedFields.add(target.name);
}
