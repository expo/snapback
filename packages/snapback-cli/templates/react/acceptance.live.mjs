// Compatibility alias: runtime acceptance is now the generated default.
import { runStarterAcceptance } from '@expo/snapback-acceptance';
import { acceptance } from './acceptance.mjs';

const result = await runStarterAcceptance(acceptance, { emit: true });
process.exitCode = result.exitCode;
