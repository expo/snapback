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
    if (element.dotDotDotToken) {
      for (const binding of bindingNames(element.name)) {
        declarations.push(`${binding} = __snapback2_rewrite_rest_binding_explicitly__()`);
      }
      return;
    }
    const selected = ts.isObjectBindingPattern(name)
      ? objectMemberAccess(access, element.propertyName, element.name, sourceFile)
      : `${access}[${index}]`;
    if (!selected) return;
    const value = element.initializer ? `(${selected} ?? ${element.initializer.getText(sourceFile)})` : selected;
    collectDeclarations(element.name, value, sourceFile, declarations);
  });
}

function objectMemberAccess(
  base: string,
  property: ts.PropertyName | undefined,
  name: ts.BindingName,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (!property) return ts.isIdentifier(name) ? `${base}.${name.text}` : undefined;
  if (ts.isIdentifier(property)) return `${base}.${property.text}`;
  if (ts.isComputedPropertyName(property)) return `${base}[${property.expression.getText(sourceFile)}]`;
  return `${base}[${property.getText(sourceFile)}]`;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => ts.isBindingElement(element) ? bindingNames(element.name) : []);
}
