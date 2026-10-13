import { Snapback } from './snapback4/snapback.ts';
import { api } from './backend/api.ts';
export const connect = (origin: string, headers: () => Record<string, string>) => {
  const db = new Snapback({origin, headers});
  return { list: () => db.read(api.list, {}), add: (body: string) => db.send(api.add, {body}) };
};
