import { generateInProcess } from './index.mjs';

// @ref LLP 0010#generated-artifacts — cache busting runs in a minimal worker before capability-denied definition evaluation.

const backendDir = process.argv[2];

try {
  const result = await generateInProcess(backendDir);
  process.send?.(result);
} catch (error) {
  process.send?.({
    ok: false,
    diagnostics: [{
      code: 'CODEGEN_MODULE_EVALUATION_FAILED',
      severity: 'error',
      subsystem: 'codegen',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    }],
  });
}
