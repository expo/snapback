import type { Client, Write } from "snapback4/contract";
import { createClient } from "snapback4/client";
import { createLocalClient } from "snapback4/local";
import { createApp, type AppOptions } from "snapback4/app";
import type { AssetState } from "snapback4/react";
import { Image, Text } from "react-native";
declare const local: Awaited<ReturnType<typeof createLocalClient>>;
declare const device: import("snapback4/local").DeviceOpener;
const appOptions: AppOptions = { url: "http://localhost:4400", assets: { keep: "viewed", maxBytes: 67108864 }, waitSeconds: 1 };
createApp({ ...appOptions, device });
createApp({ ...appOptions, device: undefined }); // Local tuning is accepted but ignored online.
// @ts-expect-error retention policies retain their literal union
createApp({ url: appOptions.url, assets: { keep: "everything", maxBytes: 1 } });
// @ts-expect-error byte budgets remain numeric
createApp({ url: appOptions.url, assets: { keep: "viewed", maxBytes: "64MB" } });
// @ts-expect-error polling intervals remain numeric
createApp({ url: appOptions.url, waitSeconds: "1" });
// @ts-expect-error identity belongs to app.auth
createApp({ url: appOptions.url, persona: "alice" });
// @ts-expect-error guest sign-in belongs to app.auth.guest()
createApp({ url: appOptions.url, guest: true });
// @ts-expect-error sessions belong to app.auth and its sessionStore
createApp({ url: appOptions.url, session: local.session()! });
// @ts-expect-error options do not admit arbitrary properties
createApp({ url: appOptions.url, arbitrary: true });
const online: Client = createClient({ url: "http://localhost:4400", persona: "alice" });
const clients: Client[] = [local, online];
for (const client of clients) {
  const acquired: boolean = client.acquired;
  client.onAcquired(value => { const ready: boolean = value; })();
  void client.write("saved-mutation-id");
  client.session();
  client.onSession(session => { const token: string | undefined = session?.token; })();
  void client.refreshSession();
  void client.logoutAll();
  void client.signOut();
}
export function Photo({ photo }: { photo: AssetState }) {
  return <>{photo.status === "ready" && <Image source={{ uri: photo.url }} />}
    {photo.status === "loading" && <Text>Loading photo…</Text>}
    {photo.status === "empty" && <Text>No photo</Text>}
    {photo.status === "denied" && <Text>{photo.why.message}</Text>}</>;
}
declare const write: Write<{ id: string }>;
if (write.state === "sent") {
  // @ts-expect-error a replay receipt cannot promise an application result
  const unchecked: { id: string } = write.result;
  if (write.replayed) {
    const absent: undefined = write.result;
  } else {
    const result: { id: string } = write.result;
  }
}

declare const read: import("snapback4/contract").Read<string[]>;
if ("data" in read) {
  const cut: "meter" | "words" | null = read.cut;
  // @ts-expect-error cut is required on every ready read, including complete empty pages
  const missingCut: typeof read = { presence: "absent", data: [], complete: true, fresh: true };
}

import { isReady, presence, type Read, type Ready, type ReadCut } from "snapback4/contract";
type Row = { id: string };
declare const point: Read<Row | null>;
if (isReady(point)) {
  const before: Row | null = point.data;
  if (point.presence === "present") { const row: Row = point.data; }
  if (point.presence === "absent") {
    const row: null = point.data, complete: true = point.complete, cut: null = point.cut;
  }
  if (point.presence === "partial") { const row: Row | null = point.data; }
}
declare const scalar: Read<boolean>;
if (isReady(scalar)) {
  const value: boolean = scalar.data;
  // @ts-expect-error scalar reads have no absent arm
  const impossible: "absent" = scalar.presence;
}
declare const array: Ready<readonly Row[]>;
if (array.presence === "absent") { const rows: readonly Row[] = array.data; }
// @ts-expect-error presence is required on every ready constructor
const missingPresence: Read<Row | null> = { data: null, complete: true, cut: null, fresh: false };
// @ts-expect-error nullable absence proves completeness
const incompleteAbsence: Read<Row | null> = { presence: "absent", data: null, complete: false, cut: null, fresh: true };
// @ts-expect-error present nullable results exclude null
const presentNull: Read<Row | null> = { presence: "present", data: null, complete: true, cut: null, fresh: true };
function genericRead<T>(read: Read<T>): T | undefined { if (isReady(read)) return read.data; }
const word: "loading" | "denied" | "present" | "absent" | "partial" = presence(point);
