import { mutation } from "snapback2";
import { _bad } from "./schema";

export const opaque = mutation({}, ({ db, ctx }) => {
  let count = 0;
  while (count < 2) {
    db.insert(_bad, { id: ctx.newId(), ownerId: ctx.viewer });
    count++;
  }
});
