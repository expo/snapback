import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

import { inspectDeclarationValueExports } from './package-export-types-lib.mjs';

function withDeclaration(name, source, run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'snapback-export-types-test-'));
  try {
    const file = path.join(directory, name);
    writeFileSync(file, source);
    return run(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('admits a declaration module with only type-space exports', () => {
  withDeclaration('types-only.d.mts', `
    export interface HandlerContext { readonly requestId: string }
    export type HandlerResult = { readonly ok: true };
    export const enum CompileTimeOnly { Ready = 'ready' }
  `, (file) => {
    assert.deepEqual(inspectDeclarationValueExports(ts, file), []);
  });
});

test('admits a private unique-symbol brand used by an exported interface', () => {
  withDeclaration('branded-type.d.mts', `
    declare const privateBrand: unique symbol;
    export interface BrandedValue { readonly [privateBrand]: true }
  `, (file) => {
    assert.deepEqual(inspectDeclarationValueExports(ts, file), []);
  });
});

test('rejects a types-only subpath declaration with a runtime value', () => {
  withDeclaration('runtime-value.d.mts', `
    export declare const runtimeValue: string;
  `, (file) => {
    assert.deepEqual(inspectDeclarationValueExports(ts, file), ['runtimeValue']);
  });
});

test('rejects explicit default and export-equals assignments', () => {
  withDeclaration('default-value.d.mts', `
    declare const runtimeValue: string;
    export default runtimeValue;
  `, (file) => {
    assert.deepEqual(inspectDeclarationValueExports(ts, file), ['default']);
  });
  withDeclaration('export-equals.d.cts', `
    declare const runtimeValue: string;
    export = runtimeValue;
  `, (file) => {
    assert.deepEqual(inspectDeclarationValueExports(ts, file), ['export =']);
  });
});
