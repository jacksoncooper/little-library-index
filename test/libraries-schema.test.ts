import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  createTestDatabase,
  deleteTestDatabase,
  postgresError,
  rejectsWithPostgresError,
  testConnection,
  withDatabaseConnection,
} from './connection';

import { Row, assertColumn, assertRowCount } from '../src/database/types';
import { readLibraryByUrlId, readOsmElementId, writeOsmElementId } from '../src/database/libraries';

beforeEach(async () => createTestDatabase(testConnection.name));

afterEach(async () =>
  // `dropdb` will fail if there are existing connections to the database.
  // `db` defines a connection pool of exactly those connections to the test
  // database. So, before we issue `dropdb`, we need to close the connections
  // that comprise the pool.
  deleteTestDatabase(testConnection.name),
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

function writeOsmElementIds(connection: SQL): Promise<Row[]> {
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

function readOsmElementIds(connection: SQL): Promise<Row[]> {
  return connection<Row[]>`
        SELECT * from osm_element_ids
        ORDER BY osm_element_ids.id;
    `;
}

describe('readOsmElementId()', () => {
  test('retrieve OSM element ID by primary key', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const rows = await writeOsmElementIds(db);
      const row1 = rows[0];
      assertColumn(row1, 'id', 'number');

      const elementId1 = await readOsmElementId(db, row1.id);
      expect(elementId1).not.toBeNull();

      expect(elementId1!.id).toBe(row1.id);
      expect(elementId1!.elementId).toBe(10783380181n);
      expect(elementId1!.elementType).toBe('node');
    }));

  test('try to retrieve nonexistent OSM element ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      // No OSM element IDs exist in the database, so any nonexistent
      // primary key will do.
      const elementId2 = await readOsmElementId(db, 1);
      expect(elementId2).toBeNull();
    }));
});

describe('writeOsmElementId()', () => {
  test('insert two open OSM element IDs', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const nodeId1 = await writeOsmElementId(db, {
        elementType: 'node',
        elementId: 10783380181n,
      });
      const nodeId2 = await writeOsmElementId(db, {
        elementType: 'node',
        elementId: 10794116980n,
      });
      expect(nodeId1).not.toBe(nodeId2);

      const nodes = await readOsmElementIds(db);
      assertRowCount(nodes, 2);

      const node1 = nodes[0];
      assertColumn(node1, 'element_type', 'string');
      // Bun's SQL module gives back PostgreSQL's `bigint` datatype as a
      // string, which is disappointing. Claude suspects this is because
      // `JSON.stringify` will throw a `TypeError` if it encounters a
      // `bigint`.
      assertColumn(node1, 'element_id', 'string');
      expect(node1.element_type).toBe('node');
      expect(node1.element_id).toBe('10783380181');

      const node2 = nodes[1];
      assertColumn(node2, 'element_type', 'string');
      assertColumn(node2, 'element_id', 'string');
      expect(node2.element_type).toBe('node');
      expect(node2.element_id).toBe('10794116980');
    }));

  test('try to insert the same OSM element ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      await writeOsmElementId(db, {
        elementType: 'node',
        elementId: 10783380181n,
      });
      await rejectsWithPostgresError(
        writeOsmElementId(db, {
          elementType: 'node',
          elementId: 10783380181n,
        }),
        postgresError.uniqueViolation,
      );
    }));
});

function writeLibrary(connection: SQL): Promise<Row[]> {
  return connection<Row[]>`
        WITH new_user AS (
            INSERT INTO users (handle)
            VALUES ('mapadu')
            RETURNING id
        ), new_osm_element_id AS (
            INSERT INTO osm_element_ids (element_type, element_id)
            VALUES ('node', 10783380181)
            RETURNING id
        )
        INSERT INTO libraries (
            created_at, created_by,
            url_id,
            location,
            title, description,
            osm_element_id
        )
        SELECT
            '2023-04-04 01:00:07 UTC',
            new_user.id,
            -- This is a placeholder URL ID.
            'ao6wm2',
            ST_Point(-122.4781917, 37.7774749, 4326)::geography,
            null,
            null,
            new_osm_element_id.id
        FROM new_user CROSS JOIN new_osm_element_id
        RETURNING id, created_by, osm_element_id;
    `;
}

describe('readLibrary()', () => {
  test('retrieve OSM element ID by URL ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const rows = await writeLibrary(db);
      assertRowCount(rows, 1);
      const row = rows[0];
      assertColumn(row, 'id', 'number');
      assertColumn(row, 'created_by', 'number');
      assertColumn(row, 'osm_element_id', 'number');

      const library = await readLibraryByUrlId(db, 'ao6wm2');

      expect(library).not.toBe(null);

      expect(library!.id).toEqual(row.id);
      expect(library!.createdAt).toEqual(
        new Date(Date.UTC(2023, 3, 4, 1, 0, 7)));
      expect(library!.createdBy).toEqual(row.created_by);
      expect(library!.urlId).toEqual('ao6wm2');
      expect(library!.location).toEqual(
        { latitude: 37.7774749, longitude: -122.4781917 });
      expect(library!.title).toBeNull();
      expect(library!.description).toBeNull();
      expect(library!.osmElementId).toEqual(row.osm_element_id);
    })
  );
});
