import { SQL } from 'bun';

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
        createdb \
            --locale-provider=icu --icu-locale=und --template=template0 \
            ${name}
        psql ${name} --quiet --file=../database/schema.sql`
        .cwd(import.meta.dir)
    );
}

export async function deleteTestDatabase(name: string): Promise<$.ShellOutput> {
    return $`dropdb ${name}`;
}

export function withDatabaseConnection<T>(
    db: SQL, query: (db: SQL) => Promise<T>
): Promise<T> {
    return query(db).then(
        result => result 
    ).finally(
        () => db.close()
    )
}
