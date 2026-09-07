import type ts from "typescript";
import type { AuthoredType, TableInfo } from "../authored-types";
import type { Expr, FrontendDiagnostic, Program, Provenance, Stmt } from "../ir";
import type { ModuleInfo } from "./module";
import type { RecursionState } from "./recursion";
import type { ValueConversion } from "./value-conversion";

export type VariableInfo = {
  runtimeName?: string;
  provenance: Provenance;
  provenanceAmbiguity?: { directRewrite?: string; candidates?: string[] };
  immutableOrigin?: Extract<ProvenanceOrigin, { expression: ts.Expression }>;
  identityExpression?: Expr;
  identityEnvironment?: Environment;
  capturedShape?: Expr;
  /** A compiler-owned register holding an already evaluated tuple component. */
  capturedTupleValue?: boolean;
  choice?: { condition: Expr; whenTrue: Expr; whenFalse: Expr; nullish?: boolean };
  /** Evaluated tuple components, captured once at the declaration. */
  tupleItems?: Expr[];
  /** An initializer's tuple shape cannot describe a mutated collection. */
  mutatedCollection?: boolean;
  operationComposite?: "args" | "ctx" | "db";
  operationArgument?: string;
  alternativeOrigins?: ProvenanceOrigin[];
  elementOrigins?: ProvenanceOrigin[];
  rowBinding?: boolean;
  rowTable?: string;
  rowCollection?: boolean;
  max?: number;
  boundSource?: string;
  collection?: "Map" | "Set";
  objectFields?: string[];
  nullableRead?: boolean;
  collectionIdentity?: object;
  collectionDeclaration?: ts.Identifier;
  locallyCreatedCollection?: boolean;
};

export type ProvenanceOrigin =
  | { expression: ts.Expression; environment: Environment }
  | { binding: VariableInfo; candidate?: string };
export type CollectionMutationCounts = Map<object, { count: number; name: string }>;
export type CollectionEscapeSite = { expression: ts.Expression; replacement: string };
export type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
export type Substitution = { expression: ts.Expression; environment: Environment; value?: Expr };
export type LowerSourceOptions = { checkedSource?: ts.SourceFile; tables?: Map<string, TableInfo>; effects?: Map<string, string>; operationPrefix?: string; sourceSites?: Record<string, import("../ir").SourceSite> };
export type Environment = ModuleInfo & {
  programName: string;
  siteBase: string;
  kind: "Query" | "Mutation";
  args: Program["args"];
  variables: Map<string, VariableInfo>;
  runtimeBindings: Map<string, VariableInfo>;
  substitutions: Map<string, Substitution>;
  helperStack: string[];
  mutableBindings: Set<ts.Identifier>;
  deferredCollectionMutations: Set<object>;
  collectionMutationCounts?: CollectionMutationCounts;
  collectionAliasSites: Map<ts.Identifier, ts.Expression[]>;
  collectionEscapeSites: Map<ts.Identifier, CollectionEscapeSite[]>;
  accessOrdinal: { value: number };
  temp: { value: number };
  literalValues: ReadonlyMap<string, number>;
  expressionTypes: ReadonlyMap<string, AuthoredType>;
  contextualTypes: ReadonlyMap<string, AuthoredType>;
  valueConversions: ReadonlyMap<string, ValueConversion>;
  literalContext: string;
  diagnostics: FrontendDiagnostic[];
  recursion: RecursionState;
};
export type LoweredValue = { statements: Stmt[]; expression: Expr };
