export type AuthoredType =
  | { kind: "unknown" }
  | { kind: "int" }
  | { kind: "decimal"; scale: number; currency?: string }
  | { kind: "enum"; variants: string[] }
  | { kind: "string"; max?: number }
  | { kind: "bool" }
  | { kind: "json" }
  | { kind: "row"; table: string }
  | { kind: "list"; of: AuthoredType; max?: number }
  | { kind: "optional"; of: AuthoredType };

export type TableInfo = {
  name: string;
  private: boolean;
  maintainedFrom?: string;
  columns?: Record<string, AuthoredType>;
};

export const unknownType: AuthoredType = { kind: "unknown" };
export const intType: AuthoredType = { kind: "int" };

export function authoredTypeFromColumn(value: unknown): AuthoredType {
  if (value === "Int" || value === "Time") return intType;
  if (value === "Bool") return { kind: "bool" };
  if (value === "Id") return { kind: "string" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return unknownType;
  const descriptor = value as Record<string, any>;
  if (descriptor.Text) return { kind: "string", max: descriptor.Text.max };
  if (descriptor.Ref) return { kind: "string" };
  if (descriptor.Json) return { kind: "json" };
  if (descriptor.Enum) return { kind: "enum", variants: [...descriptor.Enum.variants] };
  if (descriptor.Decimal) return { kind: "decimal", scale: descriptor.Decimal.scale };
  if (descriptor.Money) {
    return { kind: "decimal", scale: descriptor.Money.scale, currency: descriptor.Money.currency };
  }
  if ("Optional" in descriptor) return { kind: "optional", of: authoredTypeFromColumn(descriptor.Optional) };
  if (descriptor.List) {
    return { kind: "list", of: authoredTypeFromColumn(descriptor.List.of), max: descriptor.List.max };
  }
  return unknownType;
}

export function requiredType(value: AuthoredType | undefined): AuthoredType {
  return value?.kind === "optional" ? value.of : value ?? unknownType;
}

export function sameDecimal(left: AuthoredType, right: AuthoredType): boolean {
  return left.kind === "decimal" && right.kind === "decimal"
    && left.scale === right.scale && left.currency === right.currency;
}
