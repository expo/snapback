#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;
}

function exportedPureParams(sourceText, fileName) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result = new Map();
  for (const statement of source.statements) {
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      result.set(statement.name.text, statement.parameters.map((param) =>
        ts.isIdentifier(param.name) ? param.name.text : null
      ));
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const initializer = declaration.initializer;
        result.set(
          declaration.name.text,
          ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
            ? initializer.parameters.map((param) => (
                ts.isIdentifier(param.name) ? param.name.text : null
              ))
            : [],
        );
      }
    }
  }
  return result;
}

function mirroredPureParams(metaText, fileName) {
  return new Map(mirroredPureParamEntries(metaText, fileName)
    .map(({ name, params }) => [name, params]));
}

function mirroredPureParamEntries(metaText, fileName) {
  const source = ts.createSourceFile(fileName, metaText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result = [];
  const visit = (node) => {
    if (
      ts.isExportAssignment(node)
      && ts.isCallExpression(node.expression)
      && node.expression.arguments.length >= 2
      && ts.isObjectLiteralExpression(node.expression.arguments[1])
    ) {
      for (const property of node.expression.arguments[1].properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = propertyName(property.name);
        const call = property.initializer;
        if (!name || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== 'pure') continue;
        const descriptor = call.arguments[0];
        if (!descriptor || !ts.isObjectLiteralExpression(descriptor)) continue;
        const paramsProperty = descriptor.properties.find((candidate) =>
          ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === 'params'
        );
        if (!paramsProperty || !ts.isPropertyAssignment(paramsProperty) || !ts.isArrayLiteralExpression(paramsProperty.initializer)) continue;
        result.push({
          name,
          params: paramsProperty.initializer.elements.map((element) =>
            ts.isStringLiteral(element) ? element.text : null
          ),
          start: paramsProperty.initializer.getStart(source),
          end: paramsProperty.initializer.end,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

export function checkContractMetaPair(sourcePath, metaPath) {
  const sourceParams = exportedPureParams(readFileSync(sourcePath, 'utf8'), sourcePath);
  const mirroredParams = mirroredPureParams(readFileSync(metaPath, 'utf8'), metaPath);
  const diagnostics = [];
  for (const [name, params] of mirroredParams) {
    const actual = sourceParams.get(name);
    if (!actual) {
      diagnostics.push({
        code: 'SNAPBACK_CONTRACT_META_EXPORT_MISSING',
        source: sourcePath,
        sidecar: metaPath,
        exportName: name,
        message: `${name} is declared pure in the sidecar but is not an exported function or initialized value in ${sourcePath}`,
      });
      continue;
    }
    if (actual.some((param) => param === null) || params.some((param) => param === null)) {
      diagnostics.push({
        code: 'SNAPBACK_CONTRACT_META_PARAMS_UNCHECKABLE',
        source: sourcePath,
        sidecar: metaPath,
        exportName: name,
        message: `${name} uses a destructured or non-literal parameter name that cannot be mirrored safely`,
      });
      continue;
    }
    if (JSON.stringify(actual) !== JSON.stringify(params)) {
      diagnostics.push({
        code: 'SNAPBACK_CONTRACT_META_PARAMS_DRIFT',
        source: sourcePath,
        sidecar: metaPath,
        exportName: name,
        actual,
        mirrored: params,
        message: `${name} sidecar params ${JSON.stringify(params)} do not match TypeScript ${JSON.stringify(actual)}; regenerate or update ${metaPath}`,
      });
    }
  }
  return diagnostics;
}

function discoverSidecars(root) {
  const found = [];
  const pending = [join(root, 'demos')];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'generated' && entry.name !== 'node_modules' && entry.name !== 'dist') pending.push(path);
      } else if (entry.name.endsWith('.contract-meta.ts')) {
        found.push(path);
      }
    }
  }
  return found.sort();
}

export function discoverContractMetaPairs(root = ROOT) {
  return discoverSidecars(root).map((metaPath) => ({
    metaPath,
    sourcePath: metaPath.replace(/\.contract-meta\.ts$/, '.ts'),
  })).filter(({ sourcePath }) => existsSync(sourcePath));
}

export function refreshContractMetaPair(sourcePath, metaPath) {
  const sourceText = readFileSync(sourcePath, 'utf8');
  const metaText = readFileSync(metaPath, 'utf8');
  const sourceParams = exportedPureParams(sourceText, sourcePath);
  const replacements = [];
  for (const entry of mirroredPureParamEntries(metaText, metaPath)) {
    const actual = sourceParams.get(entry.name);
    if (!actual || actual.some((param) => param === null) || entry.params.some((param) => param === null)) {
      continue;
    }
    if (JSON.stringify(actual) !== JSON.stringify(entry.params)) {
      replacements.push({ start: entry.start, end: entry.end, text: JSON.stringify(actual) });
    }
  }
  let next = metaText;
  for (const replacement of replacements.toSorted((left, right) => right.start - left.start)) {
    next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`;
  }
  return { changed: replacements.length > 0, source: next };
}

export function checkContractMetaCorpus(root = ROOT) {
  const diagnostics = [];
  for (const { sourcePath, metaPath } of discoverContractMetaPairs(root)) {
    diagnostics.push(...checkContractMetaPair(sourcePath, metaPath));
  }
  return diagnostics;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const diagnostics = checkContractMetaCorpus();
  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) {
      console.error(`${diagnostic.code}: ${relative(ROOT, diagnostic.sidecar)}: ${diagnostic.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log('[contract-meta] PASS: pure helper params match exported TypeScript signatures');
  }
}
