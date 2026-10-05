import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const require = createRequire(resolve(repo, 'snapback4/packages/snapback4/package.json'));
const ts = require('typescript');
const files = execFileSync('git', ['diff', '--name-only', '859a1fc68e', '--', 'snapback4/packages/snapback4/test', 'snapback4/experiments/p19-one-query/equality/browser.test.mjs', 'snapback4/scripts/qualify-revocation-retention.mjs'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
function assertions(source) {
  const file = ts.createSourceFile('file.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), list = [];
  function visit(node) { if (ts.isCallExpression(node) && /^assert(?:\.|$)/.test(node.expression.getText(file))) list.push(node.getText(file)); ts.forEachChild(node, visit); }
  visit(file); return list;
}
const rows = files.map(file => {
  let oldSource = '';
  try { oldSource = execFileSync('git', ['show', `859a1fc68e:${file}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (error) { if (error.status !== 128) throw error; } // Newly added regression file.
  const before = assertions(oldSource);
  const after = assertions(readFileSync(resolve(repo, file), 'utf8')), remaining = [...after], missing = [];
  for (const call of before) { const i = remaining.indexOf(call); if (i < 0) missing.push(call); else remaining.splice(i, 1); }
  return { file, before: before.length, after: after.length, missing, added: remaining };
});
writeFileSync(new URL('./assertion-audit.json', import.meta.url), JSON.stringify(rows, null, 2));
console.log(JSON.stringify({ files: rows.length, before: rows.reduce((n, r) => n + r.before, 0), after: rows.reduce((n, r) => n + r.after, 0), missing: rows.flatMap(r => r.missing) }));
