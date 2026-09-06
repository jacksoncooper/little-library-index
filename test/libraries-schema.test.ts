import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  createLibrary,
  editLibrary,
  Library,
  Location,
  NewLibrary,
  OsmElementType,
  readLibrariesByBoundingBox,
  readLibraryByUrlId,
  readPinsByBoundingBox,
  spheroidDistance,
  splitAcrossAntiMeridian,
  WithDistance,
} from '../src/database/libraries';
import {
  assertColumn,
  assertRowCount,
  InvalidQueryRequestError,
  Row,
  WithPrimaryKey,
} from '../src/database/types';
import { createUser } from '../src/database/users';
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

function writeLibraries(connection: SQL): Promise<Row[]> {
  return connection<Row[]>`
        WITH new_user AS (
            INSERT INTO users (handle)
            VALUES ('mapadu')
            RETURNING id
        )
        INSERT INTO libraries (
            created_at, created_by,
            version, last_edited_at, last_edited_by,
            url_id,
            location,
            title, description,
            open_street_map_element_type,
            open_street_map_element_id
        )
        SELECT
            '2023-04-04 01:00:07 UTC', new_user.id,
            2, '2023-04-04 13:09:26 UTC', new_user.id,
            -- This is not a real URL ID.
            'ao6wm2',
            ST_Point(-122.4781917, 37.7774749, 4326)::geography,
            null,
            null,
            'node',
            10783380181
        FROM new_user
        RETURNING id, created_by, url_id;
    `;
}

function readLibraries(connection: SQL): Promise<Row[]> {
  return connection<Row[]>`
    SELECT
      id,
      created_at, created_by,
      version, last_edited_at, last_edited_by,
      url_id,
      ST_AsGeoJson(location) as location,
      title,
      description,
      open_street_map_element_type,
      open_street_map_element_id
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
      assertColumn(row, 'url_id', 'string');

      const library = await readLibraryByUrlId(db, row.url_id);

      expect(library).not.toBe(null);

      expect(library!.id).toEqual(row.id);
      expect(library!.createdAt).toEqual(
        new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
      );
      expect(library!.createdBy).toEqual(row.created_by);
      expect(library!.version).toEqual(2);
      expect(library!.lastEditedAt).toEqual(
        new Date(Date.UTC(2023, 3, 4, 13, 9, 26)),
      );
      expect(library!.lastEditedBy).toEqual(row.created_by);
      expect(library!.urlId).toEqual(row.url_id);
      expect(library!.location).toEqual({
        latitude: 37.7774749,
        longitude: -122.4781917,
      });
      expect(library!.title).toBeNull();
      expect(library!.description).toBeNull();
      expect(library!.osmElementId.elementType).toEqual('node');
      expect(library!.osmElementId.elementId).toEqual(10783380181n);
    }));

  test('try to retrieve a nonexistent library', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      await writeLibraries(db);
      const id = await readLibraryByUrlId(db, 'ao7wm2');
      expect(id).toBeNull();
    }));
});

describe('createLibrary()', () => {
  test('insert a new library', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      // These are implementation functions! Writing this test in terms of them
      // means that, for example, if `createUser` misbehaves by returning a
      // primary key that doesn't correspond to an entry in the users table,
      // our test will fail the foreign key constraint on insert. This is an
      // acceptable dependency for reducing test code duplication.
      const userId = await createUser(db, { handle: 'mapadu' });

      const expectedLibrary: Library = {
        createdAt: new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
        createdBy: userId,
        urlId: 'ao6wm2',
        version: 1,
        lastEditedAt: null,
        lastEditedBy: null,
        location: {
          latitude: 37.7774749,
          longitude: -122.4781917,
        },
        title: null,
        description: null,
        osmElementId: {
          elementType: 'node',
          elementId: 10783380181n,
        },
      };
      const libraryId = await createLibrary(db, expectedLibrary);

      const libraryRowsInDb = await readLibraries(db);
      assertRowCount(libraryRowsInDb, 1);
      const libraryInDb = libraryRowsInDb[0];
      assertColumn(libraryInDb, 'id', 'number');
      assertColumn(libraryInDb, 'created_at', Date);
      assertColumn(libraryInDb, 'created_by', 'number');
      assertColumn(libraryInDb, 'version', 'number');
      assertColumn(libraryInDb, 'last_edited_at', Date, true);
      assertColumn(libraryInDb, 'last_edited_by', 'number', true);
      assertColumn(libraryInDb, 'url_id', 'string');
      assertColumn(libraryInDb, 'location', 'string');
      assertColumn(libraryInDb, 'title', 'string', true);
      assertColumn(libraryInDb, 'description', 'string', true);
      assertColumn(libraryInDb, 'open_street_map_element_type', 'string', true);
      // Bun's SQL module gives back PostgreSQL's `bigint` datatype as a string,
      // which is disappointing. Sonnet 5 suspects this is because
      // `JSON.stringify` will throw a `TypeError` if it encounters a `bigint`,
      // and it's a natural operation for, say, and HTTP server to want to
      // easily serialize database results for reply to a request.
      assertColumn(libraryInDb, 'open_street_map_element_id', 'string');

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
        version: libraryInDb.version,
        lastEditedAt: libraryInDb.last_edited_at,
        lastEditedBy: libraryInDb.last_edited_by,
        urlId: libraryInDb.url_id,
        location: locationInDb,
        title: libraryInDb.title,
        description: libraryInDb.description,
        osmElementId: {
          elementType:
            libraryInDb.open_street_map_element_type as OsmElementType,
          elementId: BigInt(libraryInDb.open_street_map_element_id),
        },
      });
    }));

  test('try to insert a library with the same URL ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'mapadu' });
      const library: NewLibrary = {
        createdAt: new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
        createdBy: userId,
        urlId: 'ao6wm2',
        location: {
          latitude: 37.7774749,
          longitude: -122.4781917,
        },
        title: null,
        description: null,
        osmElementId: {
          elementType: 'node',
          elementId: 10783380181n,
        },
      };
      await createLibrary(db, library);
      await rejectsWithPostgresError(
        createLibrary(db, library),
        postgresError.unique_violation,
      );
    }));

  test('try to insert a library with a URL ID with an invalid character', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'mapadu' });
      const library: NewLibrary = {
        createdAt: new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
        createdBy: userId,
        urlId: 'ao!wm2',
        location: {
          latitude: 37.7774749,
          longitude: -122.4781917,
        },
        title: null,
        description: null,
        osmElementId: {
          elementType: 'node',
          elementId: 10783380181n,
        },
      };
      await rejectsWithPostgresError(
        createLibrary(db, library),
        postgresError.check_violation,
      );
    }));

  test('try to insert a library with a URL ID with a capital character', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'mapadu' });
      const library: NewLibrary = {
        createdAt: new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
        createdBy: userId,
        urlId: 'ao6wM2',
        location: {
          latitude: 37.7774749,
          longitude: -122.4781917,
        },
        title: null,
        description: null,
        osmElementId: {
          elementType: 'node',
          elementId: 10783380181n,
        },
      };
      await rejectsWithPostgresError(
        createLibrary(db, library),
        postgresError.check_violation,
      );
    }));

  test('try to insert a library with a URL ID with an invalid length', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'mapadu' });
      const library: NewLibrary = {
        createdAt: new Date(Date.UTC(2023, 3, 4, 1, 0, 7)),
        createdBy: userId,
        urlId: 'ao6wm27',
        location: {
          latitude: 37.7774749,
          longitude: -122.4781917,
        },
        title: null,
        description: null,
        osmElementId: {
          elementType: 'node',
          elementId: 10783380181n,
        },
      };
      await rejectsWithPostgresError(
        createLibrary(db, library),
        postgresError.string_data_right_truncation,
      );
    }));

  test('try to insert a library with a duplicate OpenStreetMap ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'penelope' });
      const library: NewLibrary = {
        createdAt: new Date(Date.UTC(2026, 7, 30, 17, 26, 0)),
        createdBy: userId,
        urlId: 'p00l3s',
        location: { latitude: 0, longitude: 0 },
        title: "Santa's lair",
        description: null,
        osmElementId: {
          elementType: 'node',
          // Fun fact: Santa's lending library was the first ever in OSM.
          elementId: 1n,
        },
      };
      const libraryWithDuplicateOsmId: NewLibrary = {
        createdAt: new Date(Date.UTC(2026, 7, 30, 17, 26, 0)),
        createdBy: userId,
        urlId: 'p00l3d', // This is different!
        location: { latitude: 0, longitude: 0 },
        title: "Santa's lair",
        description: null,
        osmElementId: {
          elementType: 'node',
          // Fun fact: Santa's lending library was the first ever in OSM.
          elementId: 1n,
        },
      };
      await createLibrary(db, library);
      await rejectsWithPostgresError(
        createLibrary(db, libraryWithDuplicateOsmId),
        postgresError.unique_violation,
      );
    }));

  test('try to insert a library with an incomplete OpenStreetMap ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'penelope' });
      const library: NewLibrary = {
        createdAt: new Date(Date.UTC(2026, 7, 30, 17, 26, 0)),
        createdBy: userId,
        urlId: 'p00l3s',
        location: { latitude: 0, longitude: 0 },
        title: "Santa's lair",
        description: null,
        osmElementId: {
          elementType: null,
          // This could be a way or a relation! Uh oh!
          elementId: 1n,
        },
      };
      await rejectsWithPostgresError(
        createLibrary(db, library),
        postgresError.check_violation,
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
    osmElementId: {
      elementType: null,
      elementId: null,
    },
  };
}

describe('splitAcrossAntiMeridian()', () => {
  test('split bounding box that does not span the anti-meridian', () => {
    const split = splitAcrossAntiMeridian({
      longitude: [-160, -100],
      latitude: [30, 50],
    });
    expect(split).toEqual([
      {
        longitude: [-160, -100],
        latitude: [30, 50],
      },
      null,
    ]);
  });

  test('split bounding box that does span the anti-meridian', () => {
    const split = splitAcrossAntiMeridian({
      longitude: [160, -150],
      latitude: [-10, 10],
    });
    expect(split).toBeInstanceOf(Array);
    expect(split).toEqual([
      {
        longitude: [-180, -150],
        latitude: [-10, 10],
      },
      {
        longitude: [160, 180],
        latitude: [-10, 10],
      },
    ]);
  });
});

describe('readPinsByBoundingBox()', () => {
  test('read pins within north-western hemisphere', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'william' });
      const points = [
        { label: urlId('a'), longitude: -165, latitude: 50 },
        { label: urlId('b'), longitude: -135, latitude: 50 }, // North boundary!
        { label: urlId('c'), longitude: -145, latitude: 40 },
        { label: urlId('d'), longitude: -150, latitude: 35 },
        { label: urlId('e'), longitude: -100, latitude: 30 }, // Southeast corner!
        { label: urlId('f'), longitude: -120, latitude: 25 },
      ];
      for (const p of points) {
        await createLibrary(
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
      const userId = await createUser(db, { handle: 'william' });
      const points = [
        { label: urlId('a'), longitude: -165, latitude: 50 },
        { label: urlId('b'), longitude: -135, latitude: 50 },
        { label: urlId('c'), longitude: -145, latitude: 40 },
        { label: urlId('d'), longitude: -150, latitude: 35 },
        { label: urlId('e'), longitude: -100, latitude: 30 },
        { label: urlId('f'), longitude: -120, latitude: 25 },
      ];
      for (const p of points) {
        await createLibrary(
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
      const userId = await createUser(db, { handle: 'william' });
      const points = [
        { label: urlId('a'), longitude: -120, latitude: 90 }, // Northwest corner!
        { label: urlId('b'), longitude: -150, latitude: 85 }, // Way out west!
        { label: urlId('c'), longitude: -105, latitude: 85 },
        { label: urlId('d'), longitude: -115, latitude: 80 }, // South boundary!
      ];
      for (const p of points) {
        await createLibrary(
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
      const userId = await createUser(db, { handle: 'william' });
      const points = [
        { label: urlId('a'), longitude: 160, latitude: 10 }, // Northeast corner.
        { label: urlId('b'), longitude: -160, latitude: 5 },
        { label: urlId('c'), longitude: -150, latitude: 0 }, // West boundary!
        { label: urlId('d'), longitude: 150, latitude: -5 },
        { label: urlId('e'), longitude: -140, latitude: -10 },
        { label: urlId('f'), longitude: 180, latitude: -10 },
      ];
      for (const p of points) {
        await createLibrary(
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
      const userId = await createUser(db, { handle: 'william' });
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
        await createLibrary(db, makePoint(label, userId, points[label]));
      }

      const result = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        4,
        null,
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
          }) as WithPrimaryKey<WithDistance<Library>>,
        );
      }
      expect(result!.cursor).toEqual({
        ascending: urlId('e'),
        descending: urlId('d'),
      });
    }));

  test('read libraries nearest to the origin by pagination', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'william' });
      const origin = { longitude: 0, latitude: 0 };
      const points = {
        // Not in the bounding box.
        [urlId('a')]: { longitude: 0, latitude: 40 },
        [urlId('b')]: { longitude: -10, latitude: 15 },
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
        await createLibrary(db, makePoint(label, userId, points[label]));
      }

      const page1 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        2,
        null,
      );
      expect(page1).not.toBeNull();
      expect(new Set(page1!.libraries.map((p) => p.urlId))).toEqual(
        new Set([urlId('d'), urlId('b')]),
      );
      expect(page1!.cursor).toEqual({
        descending: urlId('d'),
        ascending: urlId('b'),
      });

      const page2 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        2,
        { urlId: page1!.cursor.ascending!, direction: 'ascending' },
      );
      expect(page2).not.toBeNull();
      expect(new Set(page2!.libraries.map((p) => p.urlId))).toEqual(
        new Set([urlId('f'), urlId('e')]),
      );
      expect(page2!.cursor).toEqual({
        descending: urlId('f'),
        ascending: urlId('e'),
      });

      const page3 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        1,
        { urlId: page2!.cursor.ascending!, direction: 'ascending' },
      );
      expect(page3).not.toBeNull();
      expect(new Set(page3!.libraries.map((p) => p.urlId))).toEqual(
        new Set([urlId('c')]),
      );
      expect(page3!.cursor).toEqual({
        descending: urlId('c'),
        ascending: urlId('c'),
      });

      const page4 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        3,
        { urlId: page3!.cursor.ascending!, direction: 'ascending' },
      );
      expect(page4).toEqual({
        libraries: [],
        cursor: {
          ascending: null,
          descending: null,
        },
      });
    }));

  test("try to read libraries from a cursor that doesn't exist", () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'william' });
      const origin = { longitude: 0, latitude: 0 };
      const points = {
        // Not in the bounding box.
        [urlId('a')]: { longitude: 0, latitude: 40 },
        [urlId('b')]: { longitude: -10, latitude: 15 },
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
        await createLibrary(db, makePoint(label, userId, points[label]));
      }

      const result = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        4,
        { urlId: urlId('h'), direction: 'ascending' },
      );

      expect(result).toBeNull();
    }));

  test('read 4 libraries nearest to the anti-origin', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'william' });
      const origin = { longitude: 180, latitude: 0 };
      const points = {
        // Not in the bounding box.
        [urlId('a')]: { longitude: 180, latitude: 40 },
        [urlId('b')]: { longitude: -170, latitude: 15 },
        // In the bounding box, but the fifth nearest.
        [urlId('c')]: { longitude: 150, latitude: 15 },
        // The anti-origin.
        [urlId('d')]: { longitude: 180, latitude: 0 },
        [urlId('e')]: { longitude: 150, latitude: 0 },
        [urlId('f')]: { longitude: -170, latitude: -15 },
        [urlId('g')]: { longitude: 160, latitude: -20 },
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
        await createLibrary(db, makePoint(label, userId, points[label]));
      }

      const result = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [150, -165] },
        origin,
        4,
        null,
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
          }) as WithPrimaryKey<WithDistance<Library>>,
        );
      }
      expect(result!.cursor).toEqual({
        ascending: urlId('e'),
        descending: urlId('d'),
      });
    }));

  test('read libraries nearest to the origin by backward pagination', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const userId = await createUser(db, { handle: 'william' });
      const origin = { longitude: 0, latitude: 0 };
      const points = {
        // Not in the bounding box.
        [urlId('a')]: { longitude: 0, latitude: 40 },
        [urlId('b')]: { longitude: -10, latitude: 15 },
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
        await createLibrary(db, makePoint(label, userId, points[label]));
      }

      // The pagination in the forward direction takes pages size of 2, 2, 1,
      // and then 3. We'll do page sizes of 3, 1, and then 3.

      const page1 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        3,
        { urlId: urlId('c'), direction: 'descending' },
      );
      expect(page1).not.toBeNull();
      expect(new Set(page1!.libraries.map((p) => p.urlId))).toEqual(
        new Set([urlId('e'), urlId('f'), urlId('b')]),
      );
      expect(page1!.cursor).toEqual({
        ascending: urlId('e'),
        descending: urlId('b'),
      });

      const page2 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        1,
        { urlId: page1!.cursor.descending!, direction: 'descending' },
      );
      expect(page2).not.toBeNull();
      expect(new Set(page2!.libraries.map((p) => p.urlId))).toEqual(
        new Set([urlId('d')]),
      );
      expect(page2!.cursor).toEqual({
        ascending: urlId('d'),
        descending: urlId('d'),
      });

      const page3 = await readLibrariesByBoundingBox(
        db,
        { latitude: [-15, 20], longitude: [-15, 35] },
        origin,
        3,
        { urlId: page2!.cursor.ascending!, direction: 'descending' },
      );
      expect(page3).toEqual({
        libraries: [],
        cursor: {
          ascending: null,
          descending: null,
        },
      });
    }));
});

describe('editLibrary()', () => {
  test('edit a current library', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const rows = await writeLibraries(db);
      assertRowCount(rows, 1);
      const row = rows[0];
      assertColumn(row, 'url_id', 'string');

      const jacksonId = await createUser(db, { handle: 'jackson' });
      const library = await readLibraryByUrlId(db, row.url_id);
      expect(library).not.toBeNull();

      const editedLibrary = {
        ...library!,
        location: {
          latitude: 38.7774749, // Bump the library north a bit.
          longitude: -122.4781917,
        },
        title: 'Only Agatha Christie books',
        description: 'If you put something else in here I will find you 🔪',
        version: library!.version,
      };

      const result = await editLibrary(db, editedLibrary, {
        by: jacksonId,
        at: new Date(Date.UTC(2026, 7, 27, 9, 57, 0)),
      });

      expect(result).not.toBeNull();
      expect(result).toEqual({
        ...editedLibrary,
        lastEditedAt: new Date(Date.UTC(2026, 7, 27, 9, 57, 0)),
        lastEditedBy: jacksonId,
        version: library!.version + 1,
      });
    }));

  test("edit a library that isn't current", () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const rows = await writeLibraries(db);
      assertRowCount(rows, 1);
      const row = rows[0];
      assertColumn(row, 'url_id', 'string');

      const jacksonId = await createUser(db, { handle: 'jackson' });
      const library = await readLibraryByUrlId(db, row.url_id);
      expect(library).not.toBeNull();

      // Oops! Someone beat Jackson to the update.
      await db`
        UPDATE libraries
        SET version = ${library!.version + 1} WHERE url_id = ${library!.urlId}
      `;

      const editedLibrary = {
        ...library!,
        location: {
          latitude: 38.7774749, // Bump the library north a bit.
          longitude: -122.4781917,
        },
        title: 'Only Agatha Christie books',
      };

      const result = await editLibrary(db, editedLibrary, {
        by: jacksonId,
        at: new Date(Date.UTC(2026, 7, 27, 9, 57, 0)),
      });

      // The API should return the current version of the library.
      expect(result).toEqual({ ...library!, version: library!.version + 1 });
    }));

  test("edit a library that doesn't exist", () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });

      const editedLibrary = {
        urlId: 'ao6wm2',
        version: 1,
        location: {
          latitude: 38.7774749, // Bump the library north a bit.
          longitude: -122.4781917,
        },
        title: 'Only Agatha Christie books',
        description: null,
        osmElementId: {
          elementType: null,
          elementId: null,
        },
      };

      const result = await editLibrary(db, editedLibrary, {
        by: jacksonId,
        at: new Date(Date.UTC(2026, 7, 27, 9, 57, 0)),
      });

      expect(result).toBeNull();
    }));
});
