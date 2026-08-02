import { $, SQL } from 'bun';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { Row } from '../src/database/types';
import { readUser } from '../src/database/users';

import { testConnection, testDatabaseName } from './connection';

async function createTestDatabase(name: string): Promise<$.ShellOutput> {
    // An unusual design choice of Bun's shell API is that Promises constructed
    // with `$` do not execute until awaited.
    //
    //   By default, a non-zero exit code throws an error.

    // TODO: These arguments to `createdb` may not be portable. They're
    // definitely not potable.
    return ($`\
        createdb \
            --locale-provider=icu --icu-locale=und --template=template0 \
            ${name}
        psql ${name} --quiet --file=../database/schema.sql`
        .cwd(import.meta.dir)
    );
}

async function deleteTestDatabase(name: string): Promise<$.ShellOutput> {
    return $`dropdb ${name}`;
}

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

function withDatabaseConnection<T>(
    db: SQL, query: (db: SQL) => Promise<T>
): Promise<T> {
    return query(db).then(
        result => result 
    ).finally(
        () => db.close()
    )
}
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
