import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { assertColumn, assertRowCount, Row } from '../src/database/types';
import { createUser, readUserByHandle } from '../src/database/users';
import {
  createTestDatabase,
  deleteTestDatabase,
  makeConnection,
  postgresError,
  rejectsWithPostgresError,
  withDatabaseConnection,
} from './connection';

const testConnection = makeConnection();

beforeEach(async () => createTestDatabase(testConnection.name));

afterEach(async () =>
  // `dropdb` will fail if there are existing connections to the database.
  // `db` defines a connection pool of exactly those connections to the test
  // database. So, before we issue `dropdb`, we need to close the connections
  // that comprise the pool.
  deleteTestDatabase(testConnection.name),
);

function createUsers(connection: SQL): Promise<void> {
  // Similar to Promises constructed with `$`, the query will not execute
  // until the promise is awaited.
  return connection<void>`
        INSERT INTO users (handle)
        VALUES ('turing'), ('lovelace'), ('sedgewick');
    `;
}

function readUserByHandles(connection: SQL): Promise<Row[]> {
  return connection<Row[]>`
        SELECT * from users
        ORDER BY id;
    `;
}

describe('readUserByHandle()', () => {
  test('retrieve user by handle', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      await createUsers(db);
      const user = await readUserByHandle(db, 'lovelace');
      expect(user).not.toBeNull();
      expect(user!.handle).toBe('lovelace');
    }));

  test('try to retrieve nonexistent user', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      await createUsers(db);
      const user = await readUserByHandle(db, 'skiena');
      expect(user).toBeNull();
    }));
});

describe('createUser()', () => {
  test('insert a new user', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const turingId = await createUser(db, { handle: 'turing' });
      const lovelaceId = await createUser(db, { handle: 'lovelace' });
      expect(turingId).not.toBe(lovelaceId);

      const users = await readUserByHandles(db);
      assertRowCount(users, 2);

      const turing = users[0];
      assertColumn(turing, 'id', 'number');
      assertColumn(turing, 'handle', 'string');
      expect(turing.id).toBe(turingId);
      expect(turing.handle).toBe('turing');

      const lovelace = users[1];
      assertColumn(lovelace, 'id', 'number');
      assertColumn(lovelace, 'handle', 'string');
      expect(lovelace.id).toBe(lovelaceId);
      expect(lovelace.handle).toBe('lovelace');
    }));

  test('try to insert an existing user', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      await createUser(db, { handle: 'turing' });
      await rejectsWithPostgresError(
        createUser(db, { handle: 'turing' }),
        postgresError.unique_violation,
      );
    }));
});
