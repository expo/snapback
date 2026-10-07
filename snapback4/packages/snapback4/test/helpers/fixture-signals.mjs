// @ref LLP 3000#publication-suite-under-contention — bind faults to the exact
// executable and paths selected for this fixture, including private binaries.
import path from 'node:path';
import { signalRecorded } from '../../../../scripts/test-signals.mjs';

// The caller supplies the same canonical binary/root used for launch. Do not
// normalize observed argv or accept alternate /var and /private spellings.
export function fixtureCommands(binary, project) {
  const root = path.join(project, 'artifacts/native-smoke');
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const run = new RegExp('^' + escaped + '/[0-9]+-[0-9]+$');
  const source = new RegExp('^' + escaped + '/[0-9]+-[0-9]+/publication-export$');
  const retention = new RegExp('^' + escaped + '/\\.retention-[^/]+$');
  return [
    [binary, 'witness', 'background-worker', run],
    [binary, 'witness', 'background-run', run],
    [binary, 'witness', 'export-maintenance', root],
    [binary, 'witness', 'export-maintain', root, /^[0-9]+$/],
    [binary, 'witness', 'export-maintain-scan', root, /^[0-9]+$/],
    [binary, 'witness', 'export-retain-worker', retention, root],
    [binary, 'witness', 'export-publish', source, path.join(project, 'dist'), /^--(?:environment-skip|background)$/],
  ];
}
export function signalFixture(f, record, signal) {
  signalRecorded(record, signal, fixtureCommands(f.env.SNAPBACK4_BIN, f.root));
}
