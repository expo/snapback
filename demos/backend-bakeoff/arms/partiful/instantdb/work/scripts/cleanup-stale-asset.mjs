import { dbForTarget, namespace } from './lib.mjs';

const db = dbForTarget();
const files = await db.query({ $files: {} });
const armFiles = files.$files.filter((file) => file.path.startsWith(`${namespace}/`));
if (armFiles.length) {
  await db.transact(armFiles.map((file) => db.tx.$files[file.id].delete()));
}
process.stdout.write(`${JSON.stringify({ exactArmFilesDeleted: armFiles.length })}\n`);
