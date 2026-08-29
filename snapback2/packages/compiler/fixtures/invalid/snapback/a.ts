import { query } from "snapback2";
import { _bad } from "./schema";

export const unbound = query({}, ({ db }) => db.scan(_bad.byMissing, []));
