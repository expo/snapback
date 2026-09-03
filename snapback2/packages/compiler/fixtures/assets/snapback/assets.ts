import { mutation, query, t } from "snapback2";

export const inspect = mutation({
  photo: t.image(5_000_000),
  clip: t.video(50_000_000),
  albums: t.optional(t.list(t.image(12_000_000), { max: 4 })),
}, ({ args }) => ({
  photo: args.photo,
  width: args.photo.width,
  clip: args.clip,
  duration: args.clip.duration,
  albums: args.albums,
}));

export const echo = query({ photo: t.image(5_000_000) }, ({ args }) => args.photo);
