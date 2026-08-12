import { SQL } from 'bun';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    test
} from 'bun:test';

import { Row, assertColumn, assertRowCount } from '../src/database/types';
import { readUser, writeUser } from '../src/database/users';

import {
    createTestDatabase,
    deleteTestDatabase,
    postgresError,
    rejectsWithPostgresError,
    testConnection,
    withDatabaseConnection
} from './connection';

beforeEach(async () =>
    createTestDatabase(testConnection.name)
);

afterEach(async () =>
    // `dropdb` will fail if there are existing connections to the database.
    // `db` defines a connection pool of exactly those connections to the test
    // database. So, before we issue `dropdb`, we need to close the connections
    // that comprise the pool.
    deleteTestDatabase(testConnection.name)
);

function writeUsers(connection: SQL): Promise<void> {
    // Similar to Promises constructed with `$`, the query will not execute
    // until the promise is awaited.
    return connection<void>`
        INSERT INTO users (handle)
        VALUES ('turing'), ('lovelace'), ('sedgewick');
    `;
}

function readUsers(connection: SQL): Promise<Row[]> {
    return connection<Row[]>`
        SELECT * from users
        ORDER BY users.id;
    `;
}

describe('readUser()', () => {
    test('retrieve user by handle', () =>
        withDatabaseConnection(testConnection.open(), async db => {
            await writeUsers(db);
            const user = await readUser(db, 'lovelace');
            expect(user).not.toBeNull();
            expect(user!.handle).toBe('lovelace');
        })
    );

    test('try to retrieve nonexistent user', () =>
        withDatabaseConnection(testConnection.open(), async db => {
            await writeUsers(db);
            const user = await readUser(db, 'skiena');
            expect(user).toBeNull();
        })
    );
});

describe('writeUser()', () => {
    test('insert two open users', () =>
        withDatabaseConnection(testConnection.open(), async db => {
            const turingId = await writeUser(db, {handle: 'turing'});
            const lovelaceId = await writeUser(db, {handle: 'lovelace'});
            expect(turingId).not.toBe(lovelaceId);

            const users = await readUsers(db);
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
        })
    );

    test('try to insert an existing user', () =>
        withDatabaseConnection(testConnection.open(), async db => {
            await writeUser(db, {handle: 'turing'});
            await rejectsWithPostgresError(
                writeUser(db, {handle: 'turing'}),
                postgresError.uniqueViolation);
        })
    )
});
