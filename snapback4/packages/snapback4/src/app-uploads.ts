// @ref LLP 3000.038.000#4 — upload capability crosses the same session facade as ordinary writes.
import type { Client, Refusal } from "./contract.ts";
import type { UploadClient } from "./uploads.ts";
import { mintId } from "./client.ts";
export function guardUploads(client: Client, raw: Client, refusal: () => Promise<Refusal | undefined>, valid: () => boolean,
  why: () => Refusal, listen: (subscribe: (listener: (value: undefined) => void) => () => void, listener: (value: undefined) => void, ended: undefined) => () => void) {
  const source=raw as Client & Partial<UploadClient>;
  if(!source.uploadAndPlace)return;
  const uploads=source as Client & UploadClient;
  const guarded:UploadClient={
    async uploadAndPlace(op,args,bytes,options) {
      const id=options.id??mintId();
      let snapshot:typeof args;
      try { snapshot=JSON.parse(JSON.stringify(args)); }
      catch {return {state:"failed",id,why:{code:"E_INPUT",family:"input",message:"placing arguments must be JSON-serializable"}};}
      const selected=ArrayBuffer.isView(bytes)?new Uint8Array(new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength)):bytes instanceof ArrayBuffer?bytes.slice(0):bytes;
      const settings={...options,...(options.file?{file:{...options.file}}:{}),id};
      const denied=await refusal(); if(denied||!valid())return {state:"failed",id,why:denied??why()};
      return uploads.uploadAndPlace(op,snapshot,selected,settings);
    },
    async uploads(){if(await refusal())return [];const result=await uploads.uploads();return valid()?result:[];},
    async uploadIntent(id){if(await refusal())return;const result=await uploads.uploadIntent(id);return valid()?result:undefined;},
    async retryUpload(id){const denied=await refusal();return denied||!valid()?{state:"blocked",id,why:denied??why()}:uploads.retryUpload(id);},
    async discardUpload(id){const denied=await refusal();return denied||!valid()?{state:"blocked",id,why:denied??why()}:uploads.discardUpload(id);},
    onUploads:listener=>listen(notify=>uploads.onUploads(()=>notify(undefined)),listener,undefined),
    async serverUploads(after){const denied=await refusal();if(denied)return {ok:false,why:denied};const result=await uploads.serverUploads(after);return valid()?result:{ok:false,why:why()};},
    async cancelServerUpload(id){const denied=await refusal();return denied||!valid()?{ok:false,why:denied??why()}:uploads.cancelServerUpload(id);},
  };
  Object.assign(client,guarded);
}
