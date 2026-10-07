// Reuse the inherited, checksum-validating native adapter; never estimate usage.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { adaptCodexSession } = await import(pathToFileURL(process.argv[2]));
const bytes = fs.readFileSync(process.argv[3], 'utf8');
const records = bytes.slice(0, bytes.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(JSON.parse);
const adapted = adaptCodexSession(records);
console.log(JSON.stringify(adapted));
