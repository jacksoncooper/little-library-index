import { $, SQL } from 'bun';
import { expect } from 'bun:test';

export const testConnection = {
  name: 'little-library-index-test',
  open: () =>
    new SQL({
      adapter: 'postgres',
      database: testConnection.name,
    }),
};

export async function createTestDatabase(name: string): Promise<$.ShellOutput> {
  // An unusual design choice of Bun's shell API is that Promises constructed
  // with `$` do not execute until awaited.
  //
  //   By default, a non-zero exit code throws an error.

  // TODO: These arguments to `createdb` may not be portable.
  return $`\
        dropdb --if-exists ${name}
        createdb \
            --locale-provider=icu --icu-locale=und --template=template0 \
            ${name}
        psql ${name} --file=../database/schema.sql`
    .cwd(import.meta.dir)
    .quiet();
}

export async function deleteTestDatabase(name: string): Promise<$.ShellOutput> {
  return $`dropdb ${name}`;
}

export function withDatabaseConnection<T>(
  db: SQL,
  query: (db: SQL) => Promise<T>,
): Promise<T> {
  return query(db).finally(() => db.close());
}

// https://www.postgresql.org/docs/current/errcodes-appendix.html
export const postgresError = {
  check_violation: '23514',
  unique_violation: '23505',
  string_data_right_truncation: '22001',
};

export function rejectsWithPostgresError<T>(
  query: Promise<T>,
  errno: string,
): Promise<string> {
  return query.then(
    () => {
      expect().fail('query not expected to fulfill');
      expect.unreachable();
    },
    (e) => {
      expect(e).toBeInstanceOf(SQL.PostgresError);
      expect((e as SQL.PostgresError).errno).toBe(errno);
      return errno;
    },
  );
}
