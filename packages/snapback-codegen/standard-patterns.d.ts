import type { TableBuilder } from './define.mjs';

export interface OwnerVisibility<Field extends string = string> {
  kind: 'owner';
  field: Field;
}

export interface CrudNames {
  list: string;
  get: string;
  create: string;
  update: string;
  delete: string;
}

export type TrustedDefault = 'now' | 'id';

export declare function defineOwnedCrud(options: {
  table: TableBuilder;
  names: CrudNames;
  visibility: OwnerVisibility;
  idArg?: string;
  createDefaults?: Record<string, TrustedDefault>;
  updateDefaults?: Record<string, TrustedDefault>;
  immutable?: string[];
  listOrder?: string;
  listLimit?: number;
}): Readonly<Record<string, unknown>>;

export declare function defineOwnedUniqueLookup(options: {
  table: TableBuilder;
  name: string;
  index: string;
  visibility: OwnerVisibility;
  live?: boolean;
}): unknown;

export declare function defineOwnedKeysetPages(options: {
  table: TableBuilder;
  names: { first: string; next: string };
  index: string;
  cursorField?: string;
  cursor?: string;
  direction?: 'asc' | 'desc';
  limit?: number;
  visibility: OwnerVisibility;
}): Readonly<Record<string, unknown>>;

