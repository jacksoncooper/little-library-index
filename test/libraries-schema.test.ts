import { SQL } from 'bun';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    test
} from 'bun:test';

import {
    createTestDatabase,
    deleteTestDatabase,
    testConnection,
    testDatabaseName,
    withDatabaseConnection,
} from './connection';

import { assertColumn, Row } from '../src/database/types';
import { readOsmElementId } from '../src/database/libraries';

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

/*
We can use the following Overpass Turbo query (https://overpass-turbo.eu) to
generate our test data. This is a block in the Richmond District, San Francisco,
from 20th Avenue & Balboa Street to 17th Avenue & Anza Street.

node
  [amenity=public_bookcase]
  (37.77653, -122.47913, 37.77860, -122.47496);
out;
*/

async function writeOsmElementIds(connection: SQL): Promise<Row[]> {
    // The `WITH` statement is used to logically guarantee an insertion ordering
    // of the tuples that follow the `VALUES` keyword.
    return connection<Row[]>`
        WITH inserted AS(
            INSERT INTO osm_element_ids (element_type, element_id)
            VALUES
                ('node', 10783380181),
                ('node', 10794116980),
                ('node', 6625158282)
            RETURNING id
        )
        SELECT id FROM inserted ORDER BY id;
    `;
}

async function readOsmElementIds(connection: SQL): Promise<Row[]> {
    return connection<Row[]>`
        SELECT * from osm_element_ids
        ORDER BY osm_element_ids.id;
    `;
}

describe('readOsmElementId()', () => {
    test('retrieve OSM element ID by primary key', () =>
        withDatabaseConnection(testConnection(), async db => {
            const rows = await writeOsmElementIds(db);
            const row1 = rows[0];
            assertColumn(row1, 'id', 'number');

            const elementId1 = await readOsmElementId(db, row1.id);
            expect(elementId1).not.toBeNull();

            expect(elementId1!.id).toBe(row1.id);
            expect(elementId1!.elementId).toBe(10783380181n);
            expect(elementId1!.elementType).toBe('node');
        })
    );

    test('try to retrieve nonexistent OSM element ID', () =>
        withDatabaseConnection(testConnection(), async db => {
            // No OSM element IDs exist in the database, so any nonexistent
            // primary key will do.
            const elementId2 = await readOsmElementId(db, 1);
            expect(elementId2).toBeNull();
        })
    );
});
