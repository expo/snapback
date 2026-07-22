#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..', '..');
const acceptanceRoot = join(demoRoot, 'acceptance');
const resultRoot = join(acceptanceRoot, 'results', 'phase4-visual-baselines');
const indexPath = join(resultRoot, 'index.json');
const outputPath = join(resultRoot, 'gallery.html');
const spec = JSON.parse(readFileSync(join(acceptanceRoot, 'visual-spec.v1.json'), 'utf8'));
const index = JSON.parse(readFileSync(indexPath, 'utf8'));

if (!index.captureComplete || index.artifacts?.length !== spec.approval.requiredCells) {
  throw new Error(`visual gallery requires a complete ${spec.approval.requiredCells}-cell capture`);
}

const artifactByCell = new Map(index.artifacts.map((artifact) => [
  [artifact.arm, artifact.theme, artifact.viewport, artifact.state].join(':'), artifact,
]));
const sections = spec.themes.flatMap((theme) => spec.viewports.map((viewport) => {
  const rows = spec.states.map((state) => {
    const cells = spec.arms.map((arm) => {
      const artifact = artifactByCell.get([arm, theme.id, viewport.id, state.id].join(':'));
      if (!artifact) throw new Error(`missing gallery artifact ${arm}/${theme.id}/${viewport.id}/${state.id}`);
      const sourcePath = resolve(demoRoot, '..', '..', artifact.path);
      const imagePath = relative(resultRoot, sourcePath).split('\\').join('/');
      const cellId = [arm, theme.id, viewport.id, state.id].join(':');
      return `<article class="cell"><label><input type="checkbox" data-cell="${cellId}"> approve ${arm}</label><a href="${imagePath}" target="_blank"><img loading="lazy" src="${imagePath}" alt="${escapeHtml(`${arm} ${state.id}, ${theme.id}, ${viewport.id}`)}"></a><code>${artifact.sha256.slice(0, 16)}…</code></article>`;
    }).join('');
    return `<section class="row"><header><h3>${escapeHtml(state.id)}</h3><p>${escapeHtml(state.acceptance)}</p></header><div class="pair">${cells}</div></section>`;
  }).join('');
  const sectionId = `${theme.id}:${viewport.id}`;
  return `<details open data-section="${sectionId}"><summary>${escapeHtml(theme.id)} · ${escapeHtml(viewport.id)} · ${viewport.width}×${viewport.height} <button type="button" data-approve-section="${sectionId}">approve all 26</button></summary>${rows}</details>`;
})).join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Partitime Phase 4 visual review</title>
<style>
:root{color-scheme:light dark;font:14px/1.45 system-ui,sans-serif}body{margin:0;background:#151515;color:#f5f2ea}nav{position:sticky;top:0;z-index:3;padding:14px 20px;background:#151515ee;border-bottom:1px solid #555;display:flex;gap:16px;align-items:center;flex-wrap:wrap}nav h1{font-size:18px;margin:0 auto 0 0}input,button{font:inherit}button{cursor:pointer;padding:6px 10px}main{max-width:1500px;margin:auto;padding:20px}details{margin:0 0 24px;border:1px solid #555;background:#202020}summary{position:sticky;top:64px;z-index:2;padding:12px 16px;background:#292929;font-weight:700;font-size:17px}summary button{float:right}.row{display:grid;grid-template-columns:minmax(180px,280px) 1fr;gap:16px;padding:16px;border-top:1px solid #444}.row header{position:sticky;top:118px;align-self:start}.row h3{margin:0 0 6px}.row p{margin:0;color:#ccc}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cell{min-width:0}.cell label{display:block;padding:6px;background:#333;text-transform:capitalize}.cell img{display:block;width:100%;max-height:720px;object-fit:contain;object-position:top;background:#777}.cell code{display:block;padding:5px;color:#aaa;font-size:11px}#status{font-variant-numeric:tabular-nums}@media(max-width:800px){.row{grid-template-columns:1fr}.row header{position:static}.pair{grid-template-columns:1fr}}
</style></head><body><nav><h1>Partitime visual review · ${escapeHtml(index.revisions.snapback.slice(0, 12))}</h1><span id="status">0 / ${spec.approval.requiredCells} approved</span><label>Reviewer <input id="reviewer" autocomplete="name"></label><button id="export" type="button">Export signed review</button></nav><main><p>Judge every arm independently against the written acceptance text. React is a measured control, never the Contract oracle. Open any image for full resolution.</p>${sections}</main>
<script>
const boxes=[...document.querySelectorAll('[data-cell]')],status=document.querySelector('#status');
const key='partitime:${index.revisions.snapback}:${index.specVersion}:visual-review';
const saved=JSON.parse(localStorage.getItem(key)||'{}');for(const box of boxes)box.checked=!!saved[box.dataset.cell];
function sync(){const record=Object.fromEntries(boxes.map(box=>[box.dataset.cell,box.checked]));localStorage.setItem(key,JSON.stringify(record));status.textContent=boxes.filter(box=>box.checked).length+' / '+boxes.length+' approved'}
for(const box of boxes)box.addEventListener('change',sync);sync();
for(const button of document.querySelectorAll('[data-approve-section]'))button.addEventListener('click',event=>{event.preventDefault();const prefix=button.dataset.approveSection.split(':');for(const box of boxes){const parts=box.dataset.cell.split(':');if(parts[1]===prefix[0]&&parts[2]===prefix[1])box.checked=true}sync()});
document.querySelector('#export').addEventListener('click',()=>{const reviewer=document.querySelector('#reviewer').value.trim();if(!reviewer)return alert('Enter the reviewer identity first.');const reviewedAt=new Date().toISOString();const records=boxes.map(box=>{const [arm,theme,viewport,state]=box.dataset.cell.split(':');const artifact=${JSON.stringify(Object.fromEntries(index.artifacts.map((artifact) => [[artifact.arm, artifact.theme, artifact.viewport, artifact.state].join(':'), { path: artifact.path, sha256: artifact.sha256 }])))}[box.dataset.cell];return{arm,state,theme,viewport,imagePath:artifact.path,imageSha256:artifact.sha256,specVersion:${JSON.stringify(index.specVersion)},reviewer,reviewedAt,approved:box.checked}});const payload={$schema:'partitime-visual-approval/v1',revisions:${JSON.stringify(index.revisions)},specVersion:${JSON.stringify(index.specVersion)},reviewer,reviewedAt,approved:records.every(record=>record.approved),records};const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\\n'],{type:'application/json'}));link.download='partitime-visual-approval.json';link.click();URL.revokeObjectURL(link.href)});
</script></body></html>`;

writeFileSync(outputPath, html);
console.log(outputPath);

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
