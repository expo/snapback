import ts from "typescript";
import type { Expr, Stmt } from "../ir";
import type { Environment, LoweredValue } from "./environment";
import { refuse, Refusal } from "../diagnostics";
import { collectionConstructor, isNullableDbGet, temporary, unwrapCall } from "../syntax";
import { cloneEnvironment } from "./expr";
import { derivedBound } from "./binding-bound";
import { knownObjectFields, rowCollectionFields } from "./object-shape";
import { combinedProvenanceBinding, isRowCollectionExpression, isRowExpression, provenanceBinding } from "./provenance";
import { collectionFactsFor, maintainCollectionFacts } from "./collection-facts";
import { isLocallyCreatedCollection, isOperationCompositeBinding, withDirectRewrite } from "./operation-context";
import { captureTupleValues } from "./value-conversion";
import { declareBinding, runtimeBinding } from "./lexical-binding";

export function lowerVariableStatement(
  statement: ts.VariableStatement, env: Environment,
  lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue,
): Stmt[] {
  const out: Stmt[] = [];
  for (const declaration of statement.declarationList.declarations) {
    try {
      if (!declaration.initializer) {
        refuse(env, "E_OPAQUE", declaration, "destructuring declarations are not yet lowerable");
      }
      if (ts.isArrayBindingPattern(declaration.name)) {
        const call = unwrapCall(declaration.initializer);
        if (!call || !ts.isIdentifier(call.expression) || call.expression.text !== "orderedPair"
          || declaration.name.elements.length !== 2 || call.arguments.length !== 2) {
          refuse(env, "E_OPAQUE", declaration, "array destructuring is admitted only for orderedPair");
        }
        const defaulted = declaration.name.elements.find((element) => ts.isBindingElement(element) && element.initializer);
        if (defaulted) {
          refuse(
            env,
            "E_OPAQUE",
            defaulted,
            "orderedPair destructuring defaults have authored runtime semantics; normalize each input before orderedPair",
          );
        }
        const identifiers = declaration.name.elements.map((element) => ts.isBindingElement(element) && ts.isIdentifier(element.name)
          ? element.name
          : undefined);
        if (!identifiers[0] || !identifiers[1]) refuse(env, "E_OPAQUE", declaration.name, "orderedPair bindings must be identifiers");
        const args = call.arguments.map((argument) => lowerValue(argument, env));

        const values = args.map((argument, index) => {
          out.push(...argument.statements);
          const name = temporary(env, `ordered${index}`);
          out.push({ Let: { name, value: argument.expression } });
          return { Variable: name } satisfies Expr;
        });
        const origin = withDirectRewrite(combinedProvenanceBinding(call.arguments, env), declaration.initializer, env);
        const names = identifiers.map(identifier => declareBinding(identifier!.text, { ...origin }, env));
        out.push({ Let: { name: names[0]!, value: { Builtin: { builtin: "Min", args: values } } } });
        out.push({ Let: { name: names[1]!, value: { Builtin: { builtin: "Max", args: values } } } });
        continue;
      }
      if (!ts.isIdentifier(declaration.name)) refuse(env, "E_OPAQUE", declaration.name, "binding pattern is unsupported");
      const name = declaration.name.text;
      const lowered = lowerValue(declaration.initializer, env, `${env.programName}.${name}`);
      const collection = collectionConstructor(declaration.initializer);
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      const stableBinding = !env.mutableBindings.has(declaration.name);
      const loweredBinding = "Variable" in lowered.expression ? runtimeBinding(lowered.expression.Variable, env) : undefined;
      lowered.expression = captureTupleValues(lowered, env);
      const capturedShape = loweredBinding?.capturedShape ?? lowered.expression;
      const tupleItems = "Array" in capturedShape ? capturedShape.Array : undefined;
      const rowCollection = loweredBinding?.rowCollection === true || isRowCollectionExpression(declaration.initializer, env);
      const objectFields = stableBinding
        ? knownObjectFields(declaration.initializer, env) ?? (rowCollection ? rowCollectionFields(declaration.initializer, env) : undefined)
        : undefined;
      const classified = provenanceBinding(declaration.initializer, env);
      const origin = withDirectRewrite(classified, declaration.initializer, env);
      const bindTime = cloneEnvironment(env);
      const bound = derivedBound(declaration.initializer, env);
      const facts = collectionFactsFor(declaration.initializer, env, bound.max, bound.boundSource);
      if (facts.elementOrigins === undefined && loweredBinding?.elementOrigins !== undefined) {
        facts.elementOrigins = loweredBinding.elementOrigins;
      }
      const info = maintainCollectionFacts({
        ...origin,
        ...(collection || facts.max !== undefined || facts.elementOrigins !== undefined
          ? { collectionIdentity: {} }
          : {}),
        collectionDeclaration: declaration.name,
        mutatedCollection: loweredBinding?.mutatedCollection,
        locallyCreatedCollection: isLocallyCreatedCollection(declaration.initializer),
        ...(collection ? { collection } : {}),
        ...(objectFields ? { objectFields } : {}),
        ...(stableBinding ? { identityExpression: lowered.expression } : {}),
        ...(stableBinding ? { capturedShape } : {}),
        ...(stableBinding && tupleItems ? { tupleItems } : {}),
        immutableOrigin: { expression: declaration.initializer, environment: bindTime },
        ...(isRowExpression(declaration.initializer, env) ? { rowBinding: true } : {}),
        ...(rowCollection ? { rowCollection: true } : {}),
        ...(isNullableDbGet(declaration.initializer,
          (binding) => isOperationCompositeBinding(binding, "db", env)) ? { nullableRead: true } : {}),
      }, facts);
      const runtimeName = declareBinding(name, info, env);
      out.push(...lowered.statements);
      out.push(isConst && !collection
        ? { Const: { name: runtimeName, value: lowered.expression } }
        : { Let: { name: runtimeName, value: lowered.expression } });
    } catch (error) {
      if (error instanceof Refusal) env.diagnostics.push(error.diagnostic); else throw error;
    }
  }
  return out;
}
