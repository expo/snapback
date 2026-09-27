// Minimal ELF64 x64 program headers for import/parser refusal controls.
export function elf(types = [1]) {
  const b = Buffer.alloc(64 + 56 * types.length + 32);
  Buffer.from([127, 69, 76, 70, 2, 1, 1]).copy(b); b.writeUInt16LE(2, 16); b.writeUInt16LE(62, 18);
  b.writeBigUInt64LE(64n, 32); b.writeUInt16LE(56, 54); b.writeUInt16LE(types.length, 56);
  types.forEach((type, i) => { const p = 64 + i * 56; b.writeUInt32LE(type, p); if (type === 2) { b.writeBigUInt64LE(BigInt(b.length - 32), p + 8); b.writeBigUInt64LE(32n, p + 32); } });
  return b;
}
