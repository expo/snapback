import ts from "typescript";
import type { DiagnosticModule } from "./diagnostics";
import { propertyName, walk } from "./syntax";

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

export function nestedHandlerBinding(handler: FunctionLike): ts.BindingElement | undefined {
  const pattern = handler.parameters[0]?.name;
  return pattern && ts.isObjectBindingPattern(pattern)
    ? pattern.elements.find((element) => !ts.isIdentifier(element.name))
    : undefined;
}

export function nestedHandlerDestructuringRewrite(module: DiagnosticModule, handler: FunctionLike): string {
  const parameter = handler.parameters[0];
  const body = handler.body;
  if (!parameter || !ts.isObjectBindingPattern(parameter.name) || !body) return module.source;
  const occupied = new Set<string>();
  walk(handler, (node) => {
    if (ts.isIdentifier(node)) occupied.add(node.text);
  });
  const aliases = new Map<ts.BindingElement, string>();
  const declarations: string[] = [];
  for (const element of parameter.name.elements) {
    if (ts.isIdentifier(element.name)) continue;
    const property = element.propertyName ? propertyName(element.propertyName) : undefined;
    const base = property === "args" ? "packed" : `${property ?? "composite"}Packed`;
    let alias = base;
    for (let suffix = 2; occupied.has(alias); suffix += 1) alias = `${base}${suffix}`;
    occupied.add(alias);
    aliases.set(element, alias);
    const root = element.initializer
      ? `(${alias} ?? ${element.initializer.getText(module.sourceFile)})`
      : alias;
    collectDeclarations(element.name, root, module.sourceFile, declarations);
  }
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const [element, alias] of aliases) {
    const property = element.propertyName ? element.propertyName.getText(module.sourceFile) : alias;
    const defaultText = element.initializer ? ` = ${element.initializer.getText(module.sourceFile)}` : "";
    edits.push({
      start: element.getStart(module.sourceFile),
      end: element.getEnd(),
      text: `${property}: ${alias}${defaultText}`,
    });
  }
  const prefix = declarations.map((declaration) => `const ${declaration};`).join(" ");
  if (ts.isBlock(body)) {
    const bodyStart = body.getStart(module.sourceFile) + 1;
    edits.push({ start: bodyStart, end: bodyStart, text: ` ${prefix}` });
  } else {
    edits.push({
      start: body.getStart(module.sourceFile),
      end: body.getEnd(),
      text: `{ ${prefix} return ${body.getText(module.sourceFile)}; }`,
    });
  }
  let rewritten = module.source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, edit.start)}${edit.text}${rewritten.slice(edit.end)}`;
  }
  return rewritten;
}

function collectDeclarations(
  name: ts.BindingName,
  access: string,
  sourceFile: ts.SourceFile,
  declarations: string[],
): void {
  if (ts.isIdentifier(name)) {
    declarations.push(`${name.text} = ${access}`);
    return;
  }
  name.elements.forEach((element, index) => {
    if (!ts.isBindingElement(element)) return;
    const member = ts.isObjectBindingPattern(name)
      ? element.propertyName?.getText(sourceFile) ?? (ts.isIdentifier(element.name) ? element.name.text : undefined)
      : String(index);
    if (!member) return;
    const selected = ts.isObjectBindingPattern(name) ? `${access}.${member}` : `${access}[${member}]`;
    const value = element.initializer ? `(${selected} ?? ${element.initializer.getText(sourceFile)})` : selected;
    collectDeclarations(element.name, value, sourceFile, declarations);
  });
}
