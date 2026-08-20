import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  Library,
  Location,
  readLibrariesByBoundingBox,
  readLibraryByUrlId,
  readOsmElementId,
  readPinsByBoundingBox,
  spheroidDistance,
  WithDistance,
  writeLibrary,
  writeOsmElementId,
} from '../src/database/libraries';
import {
  assertColumn,
  assertRowCount,
  InvalidQueryRequestError,
  Row,
} from '../src/database/types';
import { writeUser } from '../src/database/users';
import {
  createTestDatabase,
  deleteTestDatabase,
  makeConnection,
  postgresError,
  rejectsWithPostgresError,
  withDatabaseConnection,
} from './connection';

const testConnection = makeConnection();

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
  test('insert a new OSM element ID', () =>
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
        postgresError.unique_violation,
      );
    }));
});

function writeLibraries(connection: SQL): Promise<Row[]> {
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
            -- This is not a real URL ID.
            'ao6wm2',
            ST_Point(-122.4781917, 37.7774749, 4326)::geography,
            null,
            null,
            new_osm_element_id.id
        FROM new_user CROSS JOIN new_osm_element_id
        RETURNING id, created_by, osm_element_id;
    `;
}

function readLibraries(connection: SQL): Promise<Row[]> {
  return connection<Row[]>`
    SELECT
      id,
      created_at,
      created_by,
      url_id,
      ST_AsGeoJson(location) as location,
      title,
      description,
      osm_element_id
    FROM libraries
    ORDER BY libraries.id;
  `;
}

describe('readLibraryByUrlId()', () => {
  test('retrieve library by URL ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const rows = await writeLibraries(db);
      assertRowCount(rows, 1);
      const row = rows[0];
      assertColumn(row, 'id', 'number');
      assertColumn(row, 'created_by', 'number');
      assertColumn(row, 'osm_element_id', 'number');

      const library = await readLibraryByUrlId(db, 'ao6wm2');

      expect(library).not.toBe(null);

      expect(library!.id).toEqual(row.id);
      expect(library!.createdAt).toEqual(
        new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
      );
      expect(library!.createdBy).toEqual(row.created_by);
      expect(library!.urlId).toEqual('ao6wm2');
      expect(library!.location).toEqual({
        latitude: 37.7774749,
        longitude: -122.4781917,
      });
      expect(library!.title).toBeNull();
      expect(library!.description).toBeNull();
      expect(library!.osmElementId).toEqual(row.osm_element_id);
    }));

  test('try to retrieve a nonexistent library', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      await writeLibraries(db);
      const id = await readLibraryByUrlId(db, 'ao7wm2');
      expect(id).toBeNull();
    }));
});

describe('writeLibrary()', () => {
  test('insert a new library', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      // These are implementation functions! Writing this test in terms of them
      // means that, for example, if `writeUser` misbehaves by returning a
      // primary key that doesn't correspond to an entry in the users table,
      // our test will fail the foreign key constraint on insert. This is an
      // acceptable dependency for reducing test code duplication.
      const userId = await writeUser(db, { handle: 'mapadu' });
      const osmElementId = await writeOsmElementId(db, {
        elementType: 'node',
        elementId: 10783380181n,
      });

      const expectedLibrary: Library = {
        createdAt: new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
        createdBy: userId,
        urlId: 'ao6wm2',
        location: {
          latitude: 37.7774749,
          longitude: -122.4781917,
        },
        title: null,
        description: null,
        osmElementId: osmElementId,
      };
      const libraryId = await writeLibrary(db, expectedLibrary);

      const libraryRowsInDb = await readLibraries(db);
      assertRowCount(libraryRowsInDb, 1);
      const libraryInDb = libraryRowsInDb[0];
      assertColumn(libraryInDb, 'id', 'number');
      assertColumn(libraryInDb, 'created_at', Date);
      assertColumn(libraryInDb, 'created_by', 'number');
      assertColumn(libraryInDb, 'url_id', 'string');
      assertColumn(libraryInDb, 'location', 'string');
      assertColumn(libraryInDb, 'title', 'string', true);
      assertColumn(libraryInDb, 'description', 'string', true);
      assertColumn(libraryInDb, 'osm_element_id', 'number');

      const point = JSON.parse(libraryInDb.location) as Row;
      assertColumn(point, 'coordinates', Array);
      expect(point.coordinates).toHaveLength(2);
      const locationInDb = {
        latitude: point.coordinates[1],
        longitude: point.coordinates[0],
      };
      assertColumn(locationInDb, 'latitude', 'number');
      assertColumn(locationInDb, 'longitude', 'number');

      expect(libraryId).toBe(libraryInDb.id);
      expect(expectedLibrary).toEqual({
        createdAt: libraryInDb.created_at,
        createdBy: libraryInDb.created_by,
        urlId: libraryInDb.url_id,
        location: locationInDb,
        title: libraryInDb.title,
        description: libraryInDb.description,
        osmElementId: libraryInDb.osm_element_id,
      });
    }));

  test('try to insert a library with the same URL ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'mapadu' });
      const osmElementId = await writeOsmElementId(db, {
        elementType: 'node',
        elementId: 10783380181n,
      });
      const library = {
        createdAt: new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
        createdBy: userId,
        urlId: 'ao6wm2',
        location: {
          latitude: 37.7774749,
          longitude: -122.4781917,
        },
        title: null,
        description: null,
        osmElementId: osmElementId,
      };
      await writeLibrary(db, library);
      await rejectsWithPostgresError(
        writeLibrary(db, library),
        postgresError.unique_violation,
      );
    }));

  test('try to insert a library with a URL ID with an invalid character', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'mapadu' });
      const osmElementId = await writeOsmElementId(db, {
        elementType: 'node',
        elementId: 10783380181n,
      });
      const library = {
        createdAt: new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
        createdBy: userId,
        urlId: 'ao!wm2',
        location: {
          latitude: 37.7774749,
          longitude: -122.4781917,
        },
        title: null,
        description: null,
        osmElementId: osmElementId,
      };
      await rejectsWithPostgresError(
        writeLibrary(db, library),
        postgresError.check_violation,
      );
    }));

  test('try to insert a library with a URL ID with a capital character', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'mapadu' });
      const osmElementId = await writeOsmElementId(db, {
        elementType: 'node',
        elementId: 10783380181n,
      });
      const library = {
        createdAt: new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
        createdBy: userId,
        urlId: 'ao6wM2',
        location: {
          latitude: 37.7774749,
          longitude: -122.4781917,
        },
        title: null,
        description: null,
        osmElementId: osmElementId,
      };
      await rejectsWithPostgresError(
        writeLibrary(db, library),
        postgresError.check_violation,
      );
    }));

  test('try to insert a library with a URL ID with an invalid length', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'mapadu' });
      const osmElementId = await writeOsmElementId(db, {
        elementType: 'node',
        elementId: 10783380181n,
      });
      const library = {
        createdAt: new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
        createdBy: userId,
        urlId: 'ao6wm27',
        location: {
          latitude: 37.7774749,
          longitude: -122.4781917,
        },
        title: null,
        description: null,
        osmElementId: osmElementId,
      };
      await rejectsWithPostgresError(
        writeLibrary(db, library),
        postgresError.string_data_right_truncation,
      );
    }));
});

function urlId(label: string): string {
  return label.padStart(6, '0');
}

function makePoint(urlId: string, userId: number, location: Location) {
  return {
    createdAt: new Date(Date.UTC(2026, 7, 16, 23, 57, 0)),
    createdBy: userId,
    // The URL ID has a unique constraint, so this lovely closure gets around
    // it for easy geometry tests. This technique is from Section 8.6 of
    // "JavaScript: The Definitive Guide" 7th Edition.
    urlId,
    location,
    title: null,
    description: null,
    osmElementId: null,
  };
}

describe('readPinsByBoundingBox()', () => {
  test('read pins within north-western hemisphere', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'william' });
      const points = [
        { label: urlId('a'), longitude: -165, latitude: 50 },
        { label: urlId('b'), longitude: -135, latitude: 50 }, // North boundary!
        { label: urlId('c'), longitude: -145, latitude: 40 },
        { label: urlId('d'), longitude: -150, latitude: 35 },
        { label: urlId('e'), longitude: -100, latitude: 30 }, // Southeast corner!
        { label: urlId('f'), longitude: -120, latitude: 25 },
      ];
      for (const p of points) {
        await writeLibrary(
          db,
          makePoint(p.label, userId, {
            latitude: p.latitude,
            longitude: p.longitude,
          }),
        );
      }
      const pins = await readPinsByBoundingBox(db, {
        latitude: [30, 50],
        longitude: [-160, -100],
      });
      const labels = new Set(pins.map((p) => p.urlId));
      expect(labels).toEqual(
        new Set([urlId('b'), urlId('c'), urlId('d'), urlId('e')]),
      );
    }));

  test('read no pins within north-western hemisphere', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'william' });
      const points = [
        { label: urlId('a'), longitude: -165, latitude: 50 },
        { label: urlId('b'), longitude: -135, latitude: 50 },
        { label: urlId('c'), longitude: -145, latitude: 40 },
        { label: urlId('d'), longitude: -150, latitude: 35 },
        { label: urlId('e'), longitude: -100, latitude: 30 },
        { label: urlId('f'), longitude: -120, latitude: 25 },
      ];
      for (const p of points) {
        await writeLibrary(
          db,
          makePoint(p.label, userId, {
            latitude: p.latitude,
            longitude: p.longitude,
          }),
        );
      }
      const pins = await readPinsByBoundingBox(db, {
        latitude: [30, 80],
        longitude: [-20, -5],
      });
      expect(pins).toEqual([]);
    }));

  test('read pins within north-western hemisphere near north pole 🐧', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'william' });
      const points = [
        { label: urlId('a'), longitude: -120, latitude: 90 }, // Northwest corner!
        { label: urlId('b'), longitude: -150, latitude: 85 }, // Way out west!
        { label: urlId('c'), longitude: -105, latitude: 85 },
        { label: urlId('d'), longitude: -115, latitude: 80 }, // South boundary!
      ];
      for (const p of points) {
        await writeLibrary(
          db,
          makePoint(p.label, userId, {
            latitude: p.latitude,
            longitude: p.longitude,
          }),
        );
      }
      const pins = await readPinsByBoundingBox(db, {
        latitude: [80, 90],
        longitude: [-120, -100],
      });
      const labels = new Set(pins.map((p) => p.urlId));
      expect(labels).toEqual(new Set([urlId('a'), urlId('d'), urlId('c')]));
    }));

  test('read pins crossing the anti-meridian 🐟', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'william' });
      const points = [
        { label: urlId('a'), longitude: 160, latitude: 10 }, // Northeast corner.
        { label: urlId('b'), longitude: -160, latitude: 5 },
        { label: urlId('c'), longitude: -150, latitude: 0 }, // West boundary!
        { label: urlId('d'), longitude: 150, latitude: -5 },
        { label: urlId('e'), longitude: -140, latitude: -10 },
        { label: urlId('f'), longitude: 180, latitude: -10 },
      ];
      for (const p of points) {
        await writeLibrary(
          db,
          makePoint(p.label, userId, {
            latitude: p.latitude,
            longitude: p.longitude,
          }),
        );
      }
      const pins = await readPinsByBoundingBox(db, {
        latitude: [-10, 10],
        longitude: [160, -150],
      });
      const labels = new Set(pins.map((p) => p.urlId));
      expect(labels).toEqual(
        new Set([urlId('a'), urlId('b'), urlId('c'), urlId('f')]),
      );
    }));

  test('try to read pins with an invalid longitude range', () =>
    withDatabaseConnection(testConnection.open(), (db) =>
      Promise.resolve(
        expect(
          readPinsByBoundingBox(db, {
            longitude: [-160, 190],
            latitude: [30, 50],
          }),
        ).rejects.toThrow(InvalidQueryRequestError),
      ),
    ));

  test('try to read pins with an inverted longitude range', () =>
    withDatabaseConnection(testConnection.open(), (db) =>
      Promise.resolve(
        expect(
          readPinsByBoundingBox(db, {
            longitude: [190, -160],
            latitude: [30, 50],
          }),
        ).rejects.toThrow(InvalidQueryRequestError),
      ),
    ));

  test('try to read pins with an invalid latitude range', () =>
    withDatabaseConnection(testConnection.open(), (db) =>
      Promise.resolve(
        expect(
          readPinsByBoundingBox(db, {
            longitude: [-160, -100],
            latitude: [-95, 0],
          }),
        ).rejects.toThrow(InvalidQueryRequestError),
      ),
    ));
});

describe('readLibrariesByBoundingBox()', () => {
  test('read 4 libraries nearest to the origin', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'william' });
      const origin = { longitude: 0, latitude: 0 };
      const points = {
        // Not in the bounding box.
        [urlId('a')]: { longitude: 0, latitude: 40 },
        [urlId('b')]: { longitude: -10, latitude: 15 },
        // In the bounding box, but the fifth nearest.
        [urlId('c')]: { longitude: 30, latitude: 15 },
        [urlId('d')]: { longitude: 0, latitude: 0 },
        [urlId('e')]: { longitude: 30, latitude: 0 },
        [urlId('f')]: { longitude: -10, latitude: -15 },
        [urlId('g')]: { longitude: 20, latitude: -20 },
      };
      const insertionOrder = [
        urlId('a'),
        // Point F ties with Point B for distance, so to make sure ties are
        // broken by URL ID and not primary key, insert Point F first.
        urlId('f'),
        urlId('b'),
        urlId('c'),
        urlId('d'),
        urlId('e'),
        urlId('g'),
      ];
      for (const label of insertionOrder) {
        await writeLibrary(db, makePoint(label, userId, points[label]));
      }

      const result = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        4,
      );

      // With PostGIS' spheroid model, the north and south hemispheres are
      // symmetric. Ties are broken by lexicographic comparison of URL IDs, and
      // `urlId('b') < urlId('f')`.
      const expectedLabels = [urlId('d'), urlId('b'), urlId('f'), urlId('e')];
      expect(result).not.toBeNull();
      expect(new Set(result!.libraries.map((p) => p.urlId))).toEqual(
        new Set(expectedLabels),
      );
      for (const [i, label] of expectedLabels.entries()) {
        expect(result!.libraries[i]).toEqual(
          expect.objectContaining({
            urlId: label,
            distance: await spheroidDistance(db, origin, points[label]),
          }) as WithDistance<Library>,
        );
      }
      expect(result!.cursor).toBe(urlId('e'));
    }));

  test('read libraries nearest to the origin by pagination', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'william' });
      const origin = { longitude: 0, latitude: 0 };
      const points = {
        // Not in the bounding box.
        [urlId('a')]: { longitude: 0, latitude: 40 },
        [urlId('b')]: { longitude: -10, latitude: 15 },
        // In the bounding box, but the fifth nearest.
        [urlId('c')]: { longitude: 30, latitude: 15 },
        [urlId('d')]: { longitude: 0, latitude: 0 },
        [urlId('e')]: { longitude: 30, latitude: 0 },
        [urlId('f')]: { longitude: -10, latitude: -15 },
        [urlId('g')]: { longitude: 20, latitude: -20 },
      };
      const insertionOrder = [
        urlId('a'),
        // Point F ties with Point B for distance, so to make sure ties are
        // broken by URL ID and not primary key, insert Point F first.
        urlId('f'),
        urlId('b'),
        urlId('c'),
        urlId('d'),
        urlId('e'),
        urlId('g'),
      ];
      for (const label of insertionOrder) {
        await writeLibrary(db, makePoint(label, userId, points[label]));
      }

      const page1 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        2,
      );
      expect(page1).not.toBeNull();
      expect(new Set(page1!.libraries.map((p) => p.urlId))).toEqual(
        new Set([urlId('d'), urlId('b')]),
      );

      const page2 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        2,
        page1!.cursor,
      );
      expect(page2).not.toBeNull();
      expect(new Set(page2!.libraries.map((p) => p.urlId))).toEqual(
        new Set([urlId('f'), urlId('e')]),
      );

      const page3 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        1,
        page2!.cursor,
      );
      expect(page3).not.toBeNull();
      expect(new Set(page3!.libraries.map((p) => p.urlId))).toEqual(
        new Set([urlId('c')]),
      );

      const page4 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        3,
        page3!.cursor,
      );
      expect(page4).toBeNull();
    }));
});
