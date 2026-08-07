import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Row, assertColumn } from '../src/database/types';
import { readUser, writeUser } from '../src/database/users';

import {
    createTestDatabase,
    deleteTestDatabase,
    rejectsWithPostgresError,
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

async function writeUsers(connection: SQL): Promise<Row[]> {
    // Similar to Promises constructed with `$`, the query will not execute
    // until the promise is awaited.
    return connection<Row[]>`
        INSERT INTO users (handle)
        VALUES ('turing'), ('lovelace'), ('sedgewick');
    `;
}

async function readUsers(connection: SQL): Promise<Row[]> {
    return connection<Row[]>`
        SELECT * from users;
    `;
}

describe('readUser()', () => {
    test('retrieve user by handle', () =>
        withDatabaseConnection(testConnection(), async db => {
            await writeUsers(db);
            const user = await readUser(db, 'lovelace');
            expect(user).not.toBeNull();
            expect(user!.handle).toBe('lovelace');
        })
    );

    test('try to retrieve nonexistent user', () =>
        withDatabaseConnection(testConnection(), async db => {
            await writeUsers(db);
            const user = await readUser(db, 'skiena');
            expect(user).toBeNull();
        })
    );
});

describe('writeUser()', () => {
    test('insert a new user', () =>
        withDatabaseConnection(testConnection(), async db => {
            const turingId = await writeUser(db, {handle: 'turing'});
            const lovelaceId = await writeUser(db, {handle: 'lovelace'});
            expect(turingId).not.toBe(lovelaceId);

            const users = await readUsers(db);

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
        })
    );

    test('try to insert an existing user', () =>
        withDatabaseConnection(testConnection(), async db => {
            await writeUser(db, {handle: 'turing'});
            await rejectsWithPostgresError(
                writeUser(db, {handle: 'turing'}),
                '23505');
        })
    )
});
