import { $, SQL } from 'bun';
import { expect } from 'bun:test';

export const testDatabaseName = 'little-library-index-test';

export function testConnection(): SQL {
    return new SQL({
        adapter: 'postgres',
        database: testDatabaseName,
    });
}

export async function createTestDatabase(name: string): Promise<$.ShellOutput> {
    // An unusual design choice of Bun's shell API is that Promises constructed
    // with `$` do not execute until awaited.
    //
    //   By default, a non-zero exit code throws an error.

    // TODO: These arguments to `createdb` may not be portable. They're
    // definitely not potable.
    return ($`\
        dropdb --if-exists ${name}
        createdb \
            --locale-provider=icu --icu-locale=und --template=template0 \
            ${name}
        psql ${name} --file=../database/schema.sql`
        .cwd(import.meta.dir)
        .quiet()
    );
}

export async function deleteTestDatabase(name: string): Promise<$.ShellOutput> {
    return $`dropdb ${name}`;
}

export function withDatabaseConnection<T>(
    db: SQL, query: (db: SQL) => Promise<T>
): Promise<T> {
    return query(db).finally(
        () => db.close()
    )
}

export function rejectsWithPostgresError<T>(
    query: Promise<T>,
    // https://www.postgresql.org/docs/current/errcodes-appendix.html
    errno: string
): Promise<string> {
    return query.then(
        _ => {
            expect().fail('query not expected to fulfill');
            expect.unreachable();
        },
        e => {
            expect(e).toBeInstanceOf(SQL.PostgresError);
            expect(e.errno).toBe(errno);
            return errno;
        });
}
