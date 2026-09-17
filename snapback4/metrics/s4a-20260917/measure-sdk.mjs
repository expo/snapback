import { readFileSync } from 'node:fs';
let source = readFileSync('scripts/measure-client.mjs', 'utf8');
source = source.replace('const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");', `const root = ${JSON.stringify(process.cwd())};`);
source = source.replace('appendFileSync(join(root, "metrics/client.jsonl"), JSON.stringify(out) + "\\n");', '');
source = source.replace('external: ["react", "react-dom", "react/jsx-runtime"]', 'external: id => ["react", "react-dom", "react/jsx-runtime"].includes(id) || id.endsWith("snapback4_device.js")');
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
