import { SQL } from 'bun';

export const testDatabaseName = 'little-library-index-test';

export function testConnection(): SQL {
    return new SQL({
        adapter: 'postgres',
        database: testDatabaseName,
    });
}
