import ts from "typescript";
import { refuse } from "../diagnostics";
import { unwrapExpression } from "../syntax";
import type { Environment } from "./environment";
import { expandHelper } from "./helper-expansion";
import { guardedWalk } from "./recursion";

/** Keep the existing assignment/legacy-domain subset while sharing value lowering.
 * Statement setup is necessary for faithful evaluation of its accepted forms;
 * it does not introduce collection pipelines or conditional assignments. */
export function checkAssignmentForm(expression: ts.Expression, env: Environment): void {
  guardedWalk(env, expression, "assignment expression", () => {
    const value = unwrapExpression(expression);
    const expanded = expandHelper(value, env);
    if (expanded) { checkAssignmentForm(expanded.expression, expanded.environment); return; }
    if (ts.isConditionalExpression(value) || ts.isNewExpression(value)
      || ts.isPropertyAccessChain(value)
      || ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      refuse(env, "E_OPAQUE", value, "this expression requires an immutable declaration before use here",
        "bind the expression to an immutable local and use that local here");
    }
    if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)
      && ["map", "flatMap", "filter", "reduce", "some", "require"].includes(value.expression.name.text)) {
      refuse(env, "E_OPAQUE", value, "this collection expression requires an immutable declaration before use here",
        "bind the collection result to an immutable local and use that local here");
    }
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isExpression(node)) checkAssignmentForm(node, env);
      else ts.forEachChild(node, visit);
    };
    ts.forEachChild(value, visit);
  });
}
