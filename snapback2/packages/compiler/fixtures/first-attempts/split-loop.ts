const users = table("users");

export const resolveWords = query({ body: scalar() }, ({ db, args }) => {
  let result: any[] = [];
  for (const word of args.body.split(" ")) {
    result.push(db.get(users.byHandle, word));
  }
  return result;
});
