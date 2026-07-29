import { randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";

const password = () => `${randomBytes(18).toString("base64url")}aA1!`;
const content = [
  "ALICE_EMAIL=alice@llp0102.local",
  `ALICE_PASSWORD=${password()}`,
  "BOB_EMAIL=bob@llp0102.local",
  `BOB_PASSWORD=${password()}`,
  "MALLORY_EMAIL=mallory@llp0102.local",
  `MALLORY_PASSWORD=${password()}`,
  "",
].join("\n");

await writeFile(".arm-secrets", content, { mode: 0o600 });
await chmod(".arm-secrets", 0o600);
console.log(JSON.stringify({ ok: true, personas: 3, secretValuesPrinted: false }));
