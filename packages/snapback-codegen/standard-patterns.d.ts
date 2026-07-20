import type { TableBuilder, Validator } from './define.js';

type FieldName<Fields extends Record<string, Validator>> = Extract<keyof Fields, string>;
type RequiredFieldName<Fields extends Record<string, Validator>> = {
  [Name in keyof Fields]-?: Fields[Name]['optional'] extends false ? Name : never;
}[keyof Fields] & string;
type OwnerFieldName<Fields extends Record<string, Validator>> = {
  [Name in keyof Fields]-?: Fields[Name] extends Validator<string, 'String' | 'Principal', false>
    ? Name
    : never;
}[keyof Fields] & string;
type TrustedDefaultFor<Input extends Validator> =
  Input extends Validator<unknown, 'String', false> ? 'id'
    : Input extends Validator<unknown, 'Integer' | 'Real', boolean> ? 'now'
      : never;
type TrustedDefaults<Fields extends Record<string, Validator>> = Partial<{
  [Name in keyof Fields]: TrustedDefaultFor<Fields[Name]>;
}>;
type PatternDefinitions<Name extends string> = Readonly<Record<Name, unknown>>;
type SystemOrderField = '_id' | '_version' | '_createdAt' | '_updatedAt';

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

export interface KeysetNames {
  first: string;
  next: string;
}

export type TrustedDefault = 'now' | 'id';

export declare function defineOwnedCrud<
  const Fields extends Record<string, Validator>,
  const Names extends CrudNames,
>(options: {
  table: TableBuilder<Fields>;
  names: Names;
  visibility: OwnerVisibility<OwnerFieldName<Fields>>;
  idArg?: string;
  createDefaults?: TrustedDefaults<Fields>;
  updateDefaults?: TrustedDefaults<Fields>;
  immutable?: Array<FieldName<Fields>>;
  listOrder?: FieldName<Fields> | SystemOrderField;
  listLimit?: number;
}): PatternDefinitions<Names[keyof CrudNames]>;

export declare function defineOwnedUniqueLookup<
  const Fields extends Record<string, Validator>,
  const Name extends string,
>(options: {
  table: TableBuilder<Fields>;
  name: Name;
  index: string;
  visibility: OwnerVisibility<OwnerFieldName<Fields>>;
  live?: boolean;
}): PatternDefinitions<Name>;

export declare function defineOwnedKeysetPages<
  const Fields extends Record<string, Validator>,
  const Names extends KeysetNames,
>(options: {
  table: TableBuilder<Fields>;
  names: Names;
  index: string;
  cursorField: RequiredFieldName<Fields>;
  cursor?: string;
  direction?: 'asc' | 'desc';
  limit?: number;
  visibility: OwnerVisibility<OwnerFieldName<Fields>>;
}): PatternDefinitions<Names[keyof KeysetNames]>;
