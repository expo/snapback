import { schema, table, t } from "snapback2";

export const media = table({
  columns: {
    photo: t.image(5_000_000),
    clip: t.video(50_000_000),
    albums: t.optional(t.list(t.image(12_000_000), { max: 4 })),
  },
});

export default schema({ tables: { media } });
