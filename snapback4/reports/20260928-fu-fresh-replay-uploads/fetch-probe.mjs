import { appendFileSync } from "node:fs";
const original = globalThis.fetch;
globalThis.fetch = async (...args) => {
  try {
    const r = await original(...args);
    if (String(args[0]).endsWith("/assets")) {
      const body = await r.clone().text();
      appendFileSync(`${process.env.FU_EVIDENCE}/uploads.jsonl`, JSON.stringify({time:new Date().toISOString(), status:r.status, headers:Object.fromEntries(r.headers), body:body.slice(0,2000)})+"\n");
    }
    return r;
  } catch(e) {
    appendFileSync(`${process.env.FU_EVIDENCE}/fetch-errors.jsonl`,JSON.stringify({url:String(args[0]), error:String(e), cause:String(e.cause), code:e.cause?.code})+"\n");
    throw e;
  }
};
