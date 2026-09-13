import { createExpoClient, createExpoSQLiteStorage, expoSqliteDriver, type ExpoClientOptions,
  type SQLiteStorage } from 'snapback3/expo';

const options: ExpoClientOptions = { url: 'https://example.invalid', databaseName: 'native.db' };
const client = createExpoClient(options);
const storage: SQLiteStorage = createExpoSQLiteStorage('secondary.db');
client.setOnline(false);
client.close();
void client.closeAsync();
void storage.close();

// @ts-expect-error low-level database namespaces must be explicit too.
expoSqliteDriver();

// @ts-expect-error databaseName and explicit storage have distinct ownership paths.
const invalid: ExpoClientOptions = { url: 'https://example.invalid', databaseName: 'one.db', storage: false };
void invalid;
