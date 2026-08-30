import ts from "typescript";
import { diagnostic } from "./diagnostics";
import type { FrontendDiagnostic } from "./ir";
import type { TableInfo } from "./compiler";
import {
  applyEdits,
  callName,
  containsCall,
  containsIncrement,
  expressionProperty,
  findAncestor,
  firstDescendantCall,
  hasAsyncModifier,
  isEffectFunction,
  isFunctionLike,
  isZero,
  memberName,
  nextStatement,
  numericLiteral,
  previousStatement,
  replaceNode,
  staticMemberPath,
  unwrapExpression,
  walk,
} from "./syntax";

type PolicyModule = {
  sourceFile: ts.SourceFile;
  source: string;
  fileName: string;
  tables: Map<string, TableInfo>;
};

export function mechanicalBoundRewrite(source: string): string {
  const sourceFile = ts.createSourceFile("bound-rewrite.ts", source, ts.ScriptTarget.ES2022, true);
  let largest: { node: ts.Expression; value: number } | undefined;
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !callName(node).endsWith(".scan")) return;
    const options = node.arguments[2];
    const takeNode = options && ts.isObjectLiteralExpression(options) ? expressionProperty(options, "take") : undefined;
    const value = numericLiteral(takeNode);
    if (takeNode && value !== undefined && (!largest || value > largest.value)) largest = { node: takeNode, value };
  });
  return largest ? replaceNode(source, largest.node, String(Math.max(1, Math.floor(largest.value / 2)))) : source;
}

export function findPolicyRefusals(module: PolicyModule, limit = 50): FrontendDiagnostic[] {
  const found: FrontendDiagnostic[] = [];
  const add = (item: FrontendDiagnostic) => {
    if (found.length < limit) found.push(item);
  };
  const visit = (node: ts.Node, currentFunction?: string) => {
    if (found.length >= limit) return;
    if (isFunctionLike(node) && isEffectFunction(node)) return;
    if (ts.isFunctionDeclaration(node) && node.name) currentFunction = node.name.text;

    if (ts.isWhileStatement(node)) {
      add(diagnostic(module, "E_OPAQUE", node, "while loops have no static iteration bound", rewriteWhile(module.source, node)));
    }
    if (ts.isAwaitExpression(node) || hasAsyncModifier(node)) {
      add(diagnostic(module, "E_OPAQUE", node, "async/await is outside data programs", module.source));
    }
    if (ts.isCallExpression(node)) {
      const name = callName(node);
      if (name === "Date.now" || (name === "Date" && node.arguments.length === 0)) {
        add(diagnostic(module, "E_AMBIENT_TIME", node, "ambient time is not replay-stable", rewriteAmbientTime(module.source, node)));
      }
      if (["Math.random", "fetch", "setTimeout", "eval"].includes(name)) {
        add(diagnostic(module, "E_OPAQUE", node, `${name} is outside the deterministic subset`, module.source));
      }
      if (currentFunction && ts.isIdentifier(node.expression) && node.expression.text === currentFunction) {
        add(diagnostic(module, "E_OPAQUE", node, "recursive helpers must use recurse with depth and fanout", module.source));
      }
    }
    ts.forEachChild(node, (child) => visit(child, currentFunction));
  };
  visit(module.sourceFile);

  const reductions: ts.CallExpression[] = [];
  const scans: ts.CallExpression[] = [];
  const forLoops: ts.ForOfStatement[] = [];
  const structuralSorts: ts.ElementAccessExpression[] = [];
  walk(module.sourceFile, (node) => {
    if (ts.isCallExpression(node) && callName(node).endsWith(".scan")) scans.push(node);
    if (ts.isCallExpression(node) && ["count", "reduce"].includes(memberName(node.expression) ?? "")) reductions.push(node);
    if (ts.isForOfStatement(node)) forLoops.push(node);
    if (ts.isElementAccessExpression(node) && isZero(node.argumentExpression) && containsCall(node.expression, ".sort")) structuralSorts.push(node);
  });

  for (const reduction of reductions) {
    if (found.length >= limit) break;
    const scan = firstDescendantCall(reduction.expression, ".scan");
    if (!scan) continue;
    if (!scanTake(scan)) {
      add(diagnostic(module, "E_UNBOUND_COUNT", reduction, "an exact reduction over a growing population has no static bound", rewriteUnboundCount(module.source)));
    }
    if (scanIsPrivate(module, scan)) add(structuralDiagnostic(module, reduction, scan));
  }

  for (const access of structuralSorts) {
    if (found.length >= limit) break;
    const scan = firstDescendantCall(access.expression, ".scan");
    if (scan && scanIsPrivate(module, scan)) add(structuralDiagnostic(module, access, scan));
  }

  for (const loop of forLoops) {
    if (found.length >= limit) break;
    const scan = firstDescendantCall(loop.expression, ".scan");
    if (scan && scanIsPrivate(module, scan) && containsIncrement(loop.statement)) {
      add(structuralLoopDiagnostic(module, loop, scan));
    }
    if (containsCall(loop.expression, ".split") && !boundedSplit(loop.expression)) {
      add(diagnostic(module, "E_UNBOUND_LOOP", loop.expression, "split-derived loop cardinality is not declared", rewriteSplit(module.source)));
    }
  }

  for (const scan of scans) {
    if (found.length >= limit) break;
    if (!scanTake(scan)) {
      add(diagnostic(
        module,
        "E_UNBOUND_SCAN",
        scan,
        "scan requires a literal take or an argument with a declared maximum",
        rewriteMapReturns(rewriteAllScans(module.sourceFile, module.source)),
      ));
    }
  }
  for (const item of boundRefusals(module, limit - found.length)) add(item);
  return found;
}

function structuralDiagnostic(module: PolicyModule, node: ts.Node, scan: ts.CallExpression): FrontendDiagnostic {
  const replacement = maintainedReplacement(module, scan);
  return diagnostic(
    module,
    "E_STRUCTURAL_COUNT",
    node,
    "reduction would expose a fact about rows hidden by a non-tautologous rule",
    replacement ? replaceNode(module.source, node, replacement) : module.source,
  );
}

function structuralLoopDiagnostic(module: PolicyModule, loop: ts.ForOfStatement, scan: ts.CallExpression): FrontendDiagnostic {
  const replacement = maintainedReplacement(module, scan) ?? "null";
  let start = loop.getStart(module.sourceFile);
  let end = loop.getEnd();
  const previous = previousStatement(module.sourceFile, loop);
  const next = nextStatement(module.sourceFile, loop);
  if (previous && ts.isVariableStatement(previous) && next && ts.isReturnStatement(next)) {
    start = previous.getStart(module.sourceFile);
    end = next.getEnd();
  }
  return diagnostic(
    module,
    "E_STRUCTURAL_COUNT",
    loop,
    "loop tally would expose a structural count through caller visibility",
    `${module.source.slice(0, start)}return ${replacement};${module.source.slice(end)}`,
  );
}

function maintainedReplacement(module: PolicyModule, scan: ts.CallExpression): string | undefined {
  const target = scan.arguments[0];
  const prefix = scan.arguments[1];
  if (!target || !prefix) return undefined;
  const table = tableReference(target, module.tables).table;
  const maintained = [...module.tables.entries()].find(([, info]) => {
    const source = info.maintainedFrom ? module.tables.get(info.maintainedFrom) : undefined;
    return source?.name === table;
  });
  if (!maintained) return undefined;
  const key = ts.isArrayLiteralExpression(prefix) && prefix.elements.length === 1
    ? prefix.elements[0]!.getText(module.sourceFile)
    : prefix.getText(module.sourceFile);
  return `db.get(${maintained[0]}, ${key})`;
}

function rewriteAllScans(sourceFile: ts.SourceFile, source: string): string {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !callName(node).endsWith(".scan") || scanTake(node)) return;
    if (node.arguments.length < 3) {
      edits.push({ start: node.arguments.end, end: node.arguments.end, text: ", { take: 50 }" });
      return;
    }
    const options = node.arguments[2];
    if (options && ts.isObjectLiteralExpression(options)) {
      const at = options.properties.pos;
      edits.push({ start: at, end: at, text: "take: 50, " });
    }
  });
  return applyEdits(source, edits);
}

function rewriteUnboundCount(source: string): string {
  const sourceFile = ts.createSourceFile("rewrite.ts", source, ts.ScriptTarget.ES2022, true);
  return rewriteAllScans(sourceFile, source).replace(/\.count\s*\(\s*\)/g, ".countCapped()");
}

function rewriteMapReturns(source: string): string {
  const sourceFile = ts.createSourceFile("rewrite-map.ts", source, ts.ScriptTarget.ES2022, true);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  walk(sourceFile, (node) => {
    if (!ts.isReturnStatement(node) || !node.expression || !ts.isCallExpression(node.expression)
      || !ts.isPropertyAccessExpression(node.expression.expression)
      || node.expression.expression.name.text !== "map") return;
    const callback = node.expression.arguments[0];
    if (!callback || !isFunctionLike(callback) || callback.parameters.length !== 1
      || !ts.isIdentifier(callback.parameters[0]!.name) || ts.isBlock(callback.body)) return;
    const binding = callback.parameters[0].name.text;
    const base = node.expression.expression.expression.getText(sourceFile);
    const value = callback.body.getText(sourceFile);
    edits.push({
      start: node.getStart(sourceFile),
      end: node.getEnd(),
      text: `let mapped = []; for (const ${binding} of ${base}) mapped.push(${value}); return mapped;`,
    });
  });
  return applyEdits(source, edits);
}

function rewriteSplit(source: string): string {
  return source.replace(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.split\(\s*(['"]) \2\s*\)/g, "mentionTokens($1)");
}

function rewriteWhile(source: string, node: ts.WhileStatement): string {
  if (!ts.isBinaryExpression(node.expression)
    || node.expression.operatorToken.kind !== ts.SyntaxKind.LessThanToken
    || !ts.isIdentifier(node.expression.left)
    || numericLiteral(node.expression.right) === undefined) return source;
  const variable = node.expression.left.text;
  const end = numericLiteral(node.expression.right)!;
  const body = node.statement.getText().replace(new RegExp(`\\b${variable}\\+\\+\\s*;?`), "");
  return replaceNode(source, node, `for (const _ of range(0, ${end})) ${body}`);
}

function rewriteAmbientTime(source: string, node: ts.CallExpression): string {
  let rewritten = replaceNode(source, node, "ctx.now()");
  if (!/\(\{[^}]*\bctx\b[^}]*\}\)\s*=>/.test(rewritten)) {
    rewritten = rewritten.replace(/\(\{([^}]*)\}\)\s*=>/, (_match, bindings: string) => {
      const values = bindings.split(",").map((value) => value.trim()).filter(Boolean);
      const db = values.indexOf("db");
      values.splice(db >= 0 ? db + 1 : 0, 0, "ctx");
      return `({ ${values.join(", ")} }) =>`;
    });
  }
  return rewritten;
}

function boundRefusals(module: PolicyModule, limit: number): FrontendDiagnostic[] {
  const results: FrontendDiagnostic[] = [];
  const visitLoop = (loop: ts.ForOfStatement, factors: Array<{ value: number; node: ts.Expression }>) => {
    const scan = firstDescendantCall(loop.expression, ".scan");
    const takeNode = scan && scan.arguments[2] && ts.isObjectLiteralExpression(scan.arguments[2])
      ? expressionProperty(scan.arguments[2], "take")
      : undefined;
    const take = numericLiteral(takeNode);
    const next = take !== undefined && takeNode ? [...factors, { value: take, node: takeNode }] : factors;
    const product = next.reduce((total, factor) => total * factor.value, 1);
    if (product > 10_240 && takeNode && results.length < limit) {
      const largest = [...next].sort((a, b) => b.value - a.value)[0]!;
      const other = product / largest.value;
      // The checker prices an unknown retained row at 1 KiB, so the 4 MiB
      // closure default admits at most 4,096 held rows. Keep the mechanical
      // rewrite inside both that shape budget and the examined-entry budget.
      const replacement = Math.max(1, Math.floor(4_096 / (other + 4)));
      results.push(diagnostic(
        module,
        "E_BOUND",
        loop,
        `nested population product ${next.map((factor) => factor.value).join(" × ")} = ${product} exceeds 10240`,
        replaceNode(module.source, largest.node, String(replacement)),
      ));
    }
    const body = ts.isBlock(loop.statement) ? loop.statement.statements : [loop.statement];
    for (const statement of body) {
      walk(statement, (node) => {
        if (results.length < limit && ts.isForOfStatement(node) && node !== loop) visitLoop(node, next);
      });
    }
  };
  walk(module.sourceFile, (node) => {
    if (results.length < limit && ts.isForOfStatement(node) && !findAncestor(node, ts.isForOfStatement)) visitLoop(node, []);
  });
  return results;
}

function scanIsPrivate(module: PolicyModule, scan: ts.CallExpression): boolean {
  const target = scan.arguments[0];
  if (!target) return false;
  const ref = tableReference(target, module.tables);
  return [...module.tables.values()].some((info) => info.name === ref.table && info.private);
}

function tableReference(node: ts.Expression, tables: Map<string, TableInfo>): { table: string; index: string } {
  const path = staticMemberPath(node);
  const direct = path && tables.get(path);
  if (direct) return { table: direct.name, index: direct.maintainedFrom ? "byGroup" : "byId" };
  const separator = path?.lastIndexOf(".") ?? -1;
  const owner = separator > 0 ? tables.get(path!.slice(0, separator)) : undefined;
  return owner
    ? { table: owner.name, index: path!.slice(separator + 1) }
    : { table: path ?? unwrapExpression(node).getText(), index: "byId" };
}

function scanTake(call: ts.CallExpression): number | "arg" | undefined {
  const options = call.arguments[2];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  const take = expressionProperty(options, "take");
  if (!take) return undefined;
  return numericLiteral(take) ?? "arg";
}

function boundedSplit(expression: ts.Expression): boolean {
  const text = expression.getText();
  return /\.split\([^)]*\)\.slice\(\s*0\s*,\s*\d+\s*\)/.test(text) || text.includes("mentionTokens(");
}
