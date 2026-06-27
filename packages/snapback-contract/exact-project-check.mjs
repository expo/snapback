// Snapback Contract descriptor validation through Exact project-check helpers.
//
// @ref LLP 0021#phase-1-specify-contractdatamanifest - generated Contract
//   descriptor modules must be validated by Exact project semantics, not only by
//   Snapback's artifact index.

import { readFileSync } from 'node:fs';

export function checkSnapbackContractDescriptors({
  compiler,
  runtime,
  contractFile,
  manifest,
  expectedInputsHash = null,
  exactRoot = null,
} = {}) {
  if (!compiler?.parseContractSource || !compiler?.compileContractSource) {
    throw new Error('checkSnapbackContractDescriptors requires Exact compiler exports.');
  }
  if (!runtime?.doctorContractDataProject) {
    throw new Error('checkSnapbackContractDescriptors requires Exact runtime data doctor exports.');
  }
  if (!contractFile) {
    throw new Error('checkSnapbackContractDescriptors requires contractFile.');
  }
  if (!manifest) {
    throw new Error('checkSnapbackContractDescriptors requires ContractDataManifest.');
  }

  const source = readFileSync(contractFile, 'utf8');
  const parsed = compiler.parseContractSource(source, contractFile);
  const staticSemantics = compiler.resolveStaticContractImportSemantics(parsed, {
    rootDir: exactRoot,
  });
  const compiled = compiler.compileContractSource(source, contractFile, {
    diagnosticsMode: 'accumulate',
    importBoundaryMode: 'project',
    importSemantics: staticSemantics.descriptors,
  });
  const descriptorUses = descriptorUsesFromContractFile(compiled.file);
  const doctorReport = runtime.doctorContractDataProject({
    manifest,
    descriptorUses,
    expectedInputsHash,
  });

  return {
    ok:
      staticSemantics.diagnostics.every((diagnostic) => diagnostic.severity !== 'error') &&
      compiled.diagnostics.every((diagnostic) => diagnostic.severity !== 'error') &&
      doctorReport.ok,
    staticSemantics,
    compiled,
    descriptorUses,
    doctorReport,
  };
}

export function assertGeneratedRowShapeIsChecked({
  compiler,
  contractFile,
  mutateSource,
  exactRoot = null,
} = {}) {
  const source = readFileSync(contractFile, 'utf8');
  const brokenSource = mutateSource(source);
  const parsed = compiler.parseContractSource(brokenSource, contractFile);
  const staticSemantics = compiler.resolveStaticContractImportSemantics(parsed, {
    rootDir: exactRoot,
  });
  const compiled = compiler.compileContractSource(brokenSource, contractFile, {
    diagnosticsMode: 'accumulate',
    importBoundaryMode: 'project',
    importSemantics: staticSemantics.descriptors,
  });
  const diagnostic = compiled.diagnostics.find((entry) => entry.code === 'shape_unknown_member');
  return {
    ok: Boolean(diagnostic),
    diagnostic: diagnostic ?? null,
    diagnostics: compiled.diagnostics,
  };
}

export function descriptorUsesFromContractFile(file) {
  const uses = [];
  for (const component of file.components ?? []) {
    for (const query of component.queries ?? []) {
      const importName = directImportName(query.expr);
      if (importName) {
        uses.push(descriptorUse(file, importName, 'query'));
      }
    }
    for (const mutation of component.mutations ?? []) {
      const importName = directImportName(mutation.expr);
      if (importName) {
        uses.push(descriptorUse(file, importName, 'mutation'));
      }
    }
  }
  return uses;
}

function descriptorUse(file, importName, kind) {
  const imported = file.imports?.[importName];
  return {
    kind,
    name: importName,
    spec: imported?.spec,
    source: imported?.span
      ? {
          file: file.sourcePath,
          line: imported.span.line,
          column: imported.span.col,
        }
      : undefined,
  };
}

function directImportName(expr) {
  if (expr?.kind === 'ident') return expr.name;
  if (expr?.kind === 'call' && expr.callee?.kind === 'ident') return expr.callee.name;
  return null;
}
