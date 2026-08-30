import { query } from "snapback2";
import { conversations } from "./schema";

export const list = query({}, ({ db }) =>
  db.scan(conversations.byId, [], { take: 50 }),
);
