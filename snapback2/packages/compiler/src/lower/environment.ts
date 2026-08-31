import type ts from "typescript";
import type { TableInfo } from "../authored-types";
import type { Expr, FrontendDiagnostic, Program, Provenance, Stmt } from "../ir";
import type { ModuleInfo } from "./module";
import type { RecursionState } from "./recursion";

export type VariableInfo = {
  provenance: Provenance;
  provenanceAmbiguity?: { directRewrite?: string; candidates?: string[] };
  immutableOrigin?: Extract<ProvenanceOrigin, { expression: ts.Expression }>;
  operationComposite?: "args" | "ctx" | "db";
  operationArgument?: string;
  alternativeOrigins?: ProvenanceOrigin[];
  elementOrigins?: ProvenanceOrigin[];
  rowBinding?: boolean;
  rowCollection?: boolean;
  max?: number;
  boundSource?: string;
  collection?: "Map" | "Set";
  objectFields?: string[];
  nullableRead?: boolean;
};

export type ProvenanceOrigin =
  | { expression: ts.Expression; environment: Environment }
  | { binding: VariableInfo; candidate?: string };
export type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
export type Substitution = { expression: ts.Expression; environment: Environment };
export type LowerSourceOptions = { tables?: Map<string, TableInfo>; effects?: Map<string, string>; operationPrefix?: string };
export type Environment = ModuleInfo & {
  programName: string;
  siteBase: string;
  kind: "Query" | "Mutation";
  args: Program["args"];
  variables: Map<string, VariableInfo>;
  substitutions: Map<string, Substitution>;
  helperStack: string[];
  mutableBindings: Set<ts.Identifier>;
  accessOrdinal: { value: number };
  temp: { value: number };
  literalValues: Map<string, number>;
  literalContext: string;
  diagnostics: FrontendDiagnostic[];
  recursion: RecursionState;
};
export type LoweredValue = { statements: Stmt[]; expression: Expr };
