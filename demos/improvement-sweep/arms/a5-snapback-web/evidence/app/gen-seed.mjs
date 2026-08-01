import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const embed = (content) => {
  const vec = [];
  for (let i = 0; i < 32; i += 1) vec.push(0);
  const lower = content.toLowerCase();
  for (let i = 0; i < lower.length; i += 1) {
    const code = lower.charCodeAt(i);
    if (code === 32 || code === 10) continue;
    vec[(code * 7 + i) % 32] += ((code % 13) - 6) / 6;
  }
  let norm = 0;
  for (let i = 0; i < 32; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return vec.map((x) => Math.round((x / norm) * 1e6) / 1e6);
};
const sha = (s) => createHash('sha256').update(s).digest('hex');

const sources = [
  {
    _id: 'src_architecture', title: 'Architecture.pdf', kind: 'pdf', uploader: 'seed:alice', uploaderName: 'Alice',
    content: 'Durable attempt identity and an authoritative cancellation fence keep late work from becoming a successful patch. Cancellation safety depends on the fence being checked inside the same serialized transaction that writes progress. Settlement records the terminal cause and whether the effect may have executed.',
  },
  {
    _id: 'src_interviews', title: 'Interview notes.md', kind: 'md', uploader: 'seed:bruno', uploaderName: 'Bruno',
    content: 'Builders said cancellation must be confirmed and observable, not advisory. They rated live progress updates above raw latency. Ambiguous outcomes should stay distinct from failures so retries stay safe.',
  },
  {
    _id: 'src_benchmarks', title: 'Benchmarks.csv', kind: 'csv', uploader: 'seed:alice', uploaderName: 'Alice',
    content: 'metric,p50,p95. read_ms,0.9,2.1. write_ms,8.2,14.9. realtime_ms,12.9,31.0. reconnect_ms,2.3,6.8. build_ms,172.4,240.2.',
  },
  {
    _id: 'src_roadmap', title: 'Roadmap.txt', kind: 'txt', uploader: 'seed:bruno', uploaderName: 'Bruno',
    content: 'Roadmap: portable vector search with exact k nearest neighbours, embeddings supplied from outside, and a float pinning rider. Semantic retrieval ships after the base profile is accepted.',
  },
];

const seed = {
  seedVersion: 'a5-research.2026-08-01.2',
  tables: {
    rooms: [{ _id: 'room_arch', name: 'Backend architecture', topic: 'Which backend properties matter for the research room shape', questionSeq: 0 }],
    invites: [
      { _id: 'inv_owner', roomId: 'room_arch', code: 'INV-OWNER-3401', role: 'owner', consumed: false, createdAt: 1783000000000 },
      { _id: 'inv_member', roomId: 'room_arch', code: 'INV-MEMBER-7702', role: 'member', consumed: false, createdAt: 1783000100000 },
      { _id: 'inv_member_spare', roomId: 'room_arch', code: 'INV-MEMBER-9909', role: 'member', consumed: false, createdAt: 1783000200000 },
    ],
    sources: sources.map((s, i) => ({
      _id: s._id, roomId: 'room_arch', title: s.title, kind: s.kind, content: s.content,
      uploaderId: s.uploader, uploaderName: s.uploaderName, assetId: '',
      contentSha256: sha(s.content), byteLength: Buffer.byteLength(s.content),
      clientKey: `seed-${s._id}`, createdAt: 1783000300000 + i * 1000,
    })),
    sourceEmbeddings: sources.map((s) => ({
      _id: `emb_${s._id.slice(4)}`, sourceId: s._id, roomId: 'room_arch',
      model: 'fixture-32', dim: 32, vector: embed(s.content),
    })),
    refreshSettings: [{ _id: 'refresh_cfg', roomId: 'room_arch', url: '', updatedAt: 0 }],
    questions: [],
    progressEvents: [],
    answers: [],
    questionAttempts: [],
    refreshRuns: [],
  },
};
writeFileSync('snapback/seed.json', JSON.stringify(seed, null, 2) + '\n');
console.log('seed written; sha of first source:', sha(sources[0].content).slice(0, 16));
