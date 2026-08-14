import { createDataClient } from '@expo/snapback/data';
import { db as reactDb } from '@expo/snapback/react/data';
import { db as expoDb } from '@expo/snapback-expo/data';
import { data } from './generated/data.mjs';

// @ref LLP 0255#s9-package-doorway-and-generated-typing
export const createA1Database = (client) => createDataClient({ client, data });
export const reactAndExpoShareDoorway = reactDb === expoDb;

export const firstPage = () => data.todos
  .using('by_owner_position')
  .orderBy('position', 'asc')
  .take(2);

export const createThree = (db) => db.transact(
  db.tx.todos.create({ title: 'one', position: 1 }),
  db.tx.todos.create({ title: 'two', position: 2 }),
  db.tx.todos.create({ title: 'three', position: 3 }),
);
