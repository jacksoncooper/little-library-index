import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  Library,
  Location,
  readLibrariesByBoundingBox,
  readLibraryByUrlId,
  readOsmElementId,
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
  postgresError,
  rejectsWithPostgresError,
  testConnection,
  withDatabaseConnection,
} from './connection';

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

const makePoint = (function () {
  let pointsGenerated = 0;
  function go(name: string, userId: number, location: Location): Library {
    pointsGenerated += 1;
    return {
      createdAt: new Date(Date.UTC(2026, 7, 16, 23, 57, 0)),
      createdBy: userId,
      // The URL ID has a unique constraint, so this lovely closure gets around
      // it for easy geometry tests. This technique is from Section 8.6 of
      // "JavaScript: The Definitive Guide" 7th Edition.
      urlId: pointsGenerated.toString().padStart(6, '0'),
      location,
      title: name,
      description: null,
      osmElementId: null,
    };
  }
  return go;
})();

describe('readLibrariesByBoundingBox()', () => {
  test('read libraries within north-western hemisphere', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'william' });
      const points = [
        { label: 'A', longitude: -165, latitude: 50 },
        { label: 'B', longitude: -135, latitude: 50 }, // North boundary!
        { label: 'C', longitude: -145, latitude: 40 },
        { label: 'D', longitude: -150, latitude: 35 },
        { label: 'E', longitude: -100, latitude: 30 }, // Southeast corner!
        { label: 'F', longitude: -120, latitude: 25 },
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
      const libraries = await readLibrariesByBoundingBox(db, {
        latitude: [30, 50],
        longitude: [-160, -100],
      });
      const names = new Set(libraries.map((l) => l.title));
      expect(names).toEqual(new Set(['B', 'C', 'D', 'E']));
    }));

  test('read libraries within north-western hemisphere near north pole 🐧', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'william' });
      const points = [
        { label: 'A', longitude: -120, latitude: 90 }, // Northwest corner!
        { label: 'B', longitude: -150, latitude: 85 }, // Way out west!
        { label: 'C', longitude: -105, latitude: 85 },
        { label: 'D', longitude: -115, latitude: 80 }, // South boundary!
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
      const libraries = await readLibrariesByBoundingBox(db, {
        latitude: [80, 90],
        longitude: [-120, -100],
      });
      const names = new Set(libraries.map((l) => l.title));
      expect(names).toEqual(new Set(['A', 'D', 'C']));
    }));

  test('read libraries crossing the anti-meridian 🐟', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await writeUser(db, { handle: 'william' });
      const points = [
        { label: 'A', longitude: 160, latitude: 10 }, // Northeast corner.
        { label: 'B', longitude: -160, latitude: 5 },
        { label: 'C', longitude: -150, latitude: 0 }, // West boundary!
        { label: 'D', longitude: 150, latitude: -5 },
        { label: 'E', longitude: -140, latitude: -10 },
        { label: 'F', longitude: 180, latitude: -10 },
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
      const libraries = await readLibrariesByBoundingBox(db, {
        latitude: [-10, 10],
        longitude: [160, -150],
      });
      const names = new Set(libraries.map((l) => l.title));
      expect(names).toEqual(new Set(['A', 'B', 'C', 'F']));
    }));

  test('try to read libraries with an invalid longitude range', () =>
    withDatabaseConnection(testConnection.open(), (db) =>
      Promise.resolve(
        expect(
          readLibrariesByBoundingBox(db, {
            longitude: [-160, 190],
            latitude: [30, 50],
          }),
        ).rejects.toThrow(InvalidQueryRequestError),
      ),
    ));

  test('try to read libraries with an inverted longitude range', () =>
    withDatabaseConnection(testConnection.open(), (db) =>
      Promise.resolve(
        expect(
          readLibrariesByBoundingBox(db, {
            longitude: [190, -160],
            latitude: [30, 50],
          }),
        ).rejects.toThrow(InvalidQueryRequestError),
      ),
    ));

  test('try to read libraries with an invalid latitude range', () =>
    withDatabaseConnection(testConnection.open(), (db) =>
      Promise.resolve(
        expect(
          readLibrariesByBoundingBox(db, {
            longitude: [-160, -100],
            latitude: [-95, 0],
          }),
        ).rejects.toThrow(InvalidQueryRequestError),
      ),
    ));
});
