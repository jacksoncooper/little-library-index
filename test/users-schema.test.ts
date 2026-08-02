import { $, SQL } from 'bun';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { Row } from '../src/database/types';
import { readUser } from '../src/database/users';

import {
    createTestDatabase,
    deleteTestDatabase,
    testConnection,
    testDatabaseName,
    withDatabaseConnection
} from './connection';

beforeEach(async () =>
    createTestDatabase(testDatabaseName)
);

afterEach(async () =>
    // `dropdb` will fail if there are existing connections to the database.
    // `db` defines a connection pool of exactly those connections to the test
    // database. So, before we issue `dropdb`, we need to close the connections
    // that comprise the pool.
    deleteTestDatabase(testDatabaseName)
);

async function writeUsers(db: SQL): Promise<Row[]> {
    // Similar to Promises constructed with `$`, the query will not execute
    // until the promise is awaited.
    return db<Row[]>`
        INSERT INTO users (handle)
        VALUES ('turing'), ('lovelace'), ('sedgewick')
    `;
}

test('retrieve user by handle', () =>
    withDatabaseConnection( testConnection(), async db => {
        await writeUsers(db);
        const user = await readUser(db, 'lovelace');
        expect(user).not.toBeNull();
        expect(user!.handle).toBe('lovelace');
    })
);

test('try to retrieve nonexistent user', () =>
    withDatabaseConnection( testConnection(), async db => {
        await writeUsers(db);
        const user = await readUser(db, 'skiena');
        expect(user).toBeNull();
    })
);
