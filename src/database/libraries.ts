import { SQL } from 'bun';

import {
  assertColumn,
  assertRowCount,
  InvalidQueryRequestError,
  QueryShapeError,
  Row,
  WithPrimaryKey,
} from './types';

type OsmElementType = 'node' | 'relation' | 'way';

type OsmElementId = {
  elementType: OsmElementType;
  elementId: bigint;
};

export type Location = {
  latitude: number;
  longitude: number;
};

export type Pin = {
  urlId: string;
  location: Location;
};

export type WithDistance<T> = T & { distance: number };

export type Library = {
  createdAt: Date;
  createdBy: number;
  urlId: string;
  location: Location;
  title: string | null;
  description: string | null;
  osmElementId: number | null;
};

export async function writeOsmElementId(
  connection: SQL,
  osmElementId: OsmElementId,
): Promise<number> {
  const rows = await connection<Row[]>`
        INSERT INTO osm_element_ids (element_type, element_id)
        VALUES (${osmElementId.elementType}, ${osmElementId.elementId})
        RETURNING id;
    `;
  assertRowCount(rows, 1);
  const row = rows[0];
  assertColumn(row, 'id', 'number');
  return row.id;
}

export async function readOsmElementId(
  connection: SQL,
  id: number,
): Promise<WithPrimaryKey<OsmElementId> | null> {
  const rows = await connection<Row[]>`
        SELECT id, element_type, element_id FROM osm_element_ids
        WHERE id = ${id};
    `;

  if (rows.length < 1) {
    return null;
  }
  assertRowCount(rows, 1);

  const row = rows[0];
  assertColumn(row, 'id', 'number');
  assertColumn(row, 'element_type', 'string');
  assertColumn(row, 'element_id', 'string');

  if (!(
    row.element_type == 'node' ||
    row.element_type == 'relation' ||
    row.element_type == 'way'
  )) {
    throw new QueryShapeError(
      `expect '${row.element_type}' to be one of ` +
        `'node', 'relation', 'way'`,
    );
  }

  return {
    id: row.id,
    // TODO: The BigInt constructor will throw a `SyntaxError` if it can't
    // parse its argument. MDN says "Strings are parsed as if they are
    // source text for integer literals," which explains the bizarre error
    // class.
    elementId: BigInt(row.element_id),
    elementType: row.element_type,
  };
}

export async function writeLibrary(
  connection: SQL,
  library: Library,
): Promise<number> {
  const rows = await connection<Row[]>`
    INSERT INTO libraries (
      created_at,
      created_by,
      url_id,
      location,
      title,
      description,
      osm_element_id
    )
    VALUES(
      ${library.createdAt},
      ${library.createdBy},
      ${library.urlId},
      ${locationToGeography(connection, library.location)},
      ${library.title},
      ${library.description},
      ${library.osmElementId}
    )
    RETURNING id;
  `;
  const row = rows[0];
  assertColumn(row, 'id', 'number');
  return row.id;
}

export function locationToGeography(
  connection: SQL,
  location: Location,
): SQL.Query<unknown> {
  const point = {
    type: 'Point',
    coordinates: [location.longitude, location.latitude],
  };
  return connection`ST_GeomFromGeoJSON(${point}::jsonb)::geography`;
}

function geoJsonToLocation(json: string): Location {
  // A nifty hack here, where we treat the parsed JSON as equivalent to a row
  // from a Postgres table. They're both an untyped object.
  const point = JSON.parse(json) as Row;
  assertColumn(point, 'coordinates', Array);
  if (point.coordinates.length != 2) {
    throw new QueryShapeError(
      'expect location to be two-dimensional,' +
        ` but got ${point.coordinates.length} dimensions`,
    );
  }
  const location = {
    latitude: point.coordinates[1],
    longitude: point.coordinates[0],
  };
  assertColumn(location, 'latitude', 'number');
  assertColumn(location, 'longitude', 'number');
  return location;
}

function rowToPin(row: Row): WithPrimaryKey<Pin> {
  assertColumn(row, 'id', 'number');
  assertColumn(row, 'url_id', 'string');
  assertColumn(row, 'location', 'string');
  return {
    id: row.id,
    urlId: row.url_id,
    location: geoJsonToLocation(row.location),
  };
}

function rowToLibrary(row: Row): WithPrimaryKey<Library> {
  assertColumn(row, 'id', 'number');
  assertColumn(row, 'created_at', Date);
  assertColumn(row, 'created_by', 'number');
  assertColumn(row, 'url_id', 'string');
  assertColumn(row, 'location', 'string');
  assertColumn(row, 'title', 'string', true);
  assertColumn(row, 'description', 'string', true);
  assertColumn(row, 'osm_element_id', 'number', true);

  return {
    id: row.id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    urlId: row.url_id,
    location: geoJsonToLocation(row.location),
    title: row.title,
    description: row.description,
    osmElementId: row.osm_element_id,
  };
}

function rowToLibraryWithDistance(
  row: Row,
): WithPrimaryKey<WithDistance<Library>> {
  assertColumn(row, 'distance', 'number');
  return {
    ...rowToLibrary(row),
    distance: row.distance,
  };
}
// Used to handle a request for a library. For example,
//
//   https://littlelibraryindex.com/library/o5c93c
//
export async function readLibraryByUrlId(
  connection: SQL,
  urlId: string,
): Promise<WithPrimaryKey<Library> | null> {
  const rows = await connection<Row[]>`
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
    WHERE url_id = ${urlId}
  `;

  if (rows.length < 1) {
    return null;
  }
  assertRowCount(rows, 1); // The `url_id` column is unique.

  const row = rows[0];
  return rowToLibrary(row);
}

// The latitude and longitude coordinate system is funky in that it has a
// discontinuity at the anti-meridian, which is a line of constant longitude at
// 180°W (or 180°E). Usually, a negative latitude is equivalent to degrees south
// (°S) and a negative longitude is equivalent to degrees west (°W). The line of
// constant longitude at zero degrees runs through London.
//
// Imagine you're at a longitude of 160°E and travel 40°E. Your new longitude as
// represented by this coordinate system is 160°W. As you cross the
// anti-meridian at 180°E, the degrees start decreasing, which makes specifying
// the interval that you traveled a non-increasing range.
//
//   [ 160°E, 160°W ] -> [ 160, -160 ]
//
// We adopt this convention for specifying ranges of longitude that cross the
// anti-meridian.
//
//   [ 160°W, 160°E ] -> [ -160, 160 ]
//
// specifies the complement of the last interval.
//
export type BoundingBox = {
  latitude: [south: number, north: number];
  longitude: [start: number, end: number];
};

export function validateBoundingBox(box: BoundingBox): void {
  // TODO: You'll probably want to extract this validation logic to the HTTP
  // layer eventually, because it will need to verify the operands to this
  // function too.
  const validateLongitudeRange = ([west, east]: [number, number]) => {
    if (!(-180 <= west && west < east && east <= 180)) {
      throw new InvalidQueryRequestError(
        `longitude must a non-empty interval in the range [-180, 180], but got` +
          ` -180 <= ${west}°W < ${east}°E < 180`,
      );
    }
  };

  const validateLatitudeRange = ([south, north]: [number, number]) => {
    if (!(-90 <= south && south < north && north <= 90)) {
      throw new InvalidQueryRequestError(
        `latitude must a non-empty interval in the range [-90, 90], but got` +
          ` -90 <= ${south}°S < ${north}°N < 90`,
      );
    }
  };

  const [start, end] = box.longitude;
  if (start <= end) {
    validateLongitudeRange([start, end]);
  } else {
    validateLongitudeRange([end, start]);
  }

  const [south, north] = box.latitude;
  validateLatitudeRange([south, north]);
}

export function splitAcrossAntiMeridian(
  box: BoundingBox,
): [BoundingBox, BoundingBox | null] {
  const [start, end] = box.longitude;

  // Validate to ensure a non-empty longitude interval, which we use as a
  // premise below.
  validateBoundingBox(box);

  if (start < end) {
    return [box, null];
  }

  return [
    {
      longitude: [-180, end],
      latitude: box.latitude,
    },
    {
      longitude: [start, 180],
      latitude: box.latitude,
    },
  ];
}

async function readLibraryTuplesByBoundingBox<T>(
  // This function works on the `location` column of the `libraries` table, so
  // `librariesTuple` must include it.
  libraryTuples: (db: SQL) => SQL.Query<unknown>,
  whereConjunction: (db: SQL) => SQL.Query<unknown>,
  orderByClause: (db: SQL) => SQL.Query<unknown>,
  transform: (row: Row) => T,
  connection: SQL,
  box: BoundingBox,
): Promise<T[]> {
  const [b1, b2] = splitAcrossAntiMeridian(box);
  const envelope2 =
    b2 === null
      ? false
      : connection`
      (location::geometry
        && ST_MakeEnvelope(
          ${b2.longitude[0]}, ${b2.latitude[0]},
          ${b2.longitude[1]}, ${b2.latitude[1]}, 4326))`;
  const rows = await connection<Row[]>`
    ${libraryTuples(connection)}
    FROM libraries
    WHERE
      -- This cast is interesting. Sonnet 5 discovered that PostGIS' &&
      -- operator with geography operands is only an approximate check of the
      -- intersection between two bounding boxes that gets worse with an
      -- absolute increase in latitude. The && operator used by the query
      -- planner to exclude points as an initial pass. So, && must never
      -- produce a false negative. Luckily, a point within a bounding box
      -- doesn't require the extra power of the geometry type.
      (
        (location::geometry
          && ST_MakeEnvelope(
            ${b1.longitude[0]}, ${b1.latitude[0]},
            ${b1.longitude[1]}, ${b1.latitude[1]}, 4326))
        OR
        ${envelope2}
      )
      ${whereConjunction(connection)}
    ${orderByClause(connection)};
  `;
  return rows.map((r) => transform(r));
}

export function readPinsByBoundingBox(
  connection: SQL,
  ranges: BoundingBox,
): Promise<Pin[]> {
  return readLibraryTuplesByBoundingBox(
    (db) => db`
    SELECT
      id,
      url_id,
      ST_AsGeoJson(location) as location
    `,
    (db) => db``,
    (db) => db``,
    rowToPin,
    connection,
    ranges,
  );
}

export type LibrariesByBoundingBox = {
  libraries: WithPrimaryKey<WithDistance<Library>>[];
  // The URL ID of the last library returned by the corresponding query.
  cursor: {
    ascending: string | null;
    descending: string | null;
  };
};

export async function spheroidDistance(
  db: SQL,
  from: Location,
  to: Location,
): Promise<number> {
  const rows = await db<Row[]>`
    SELECT
      ST_Distance(
        ${locationToGeography(db, from)},
        ${locationToGeography(db, to)}
      ) as distance;
  `;
  assertRowCount(rows, 1);
  assertColumn(rows[0], 'distance', 'number');
  return rows[0].distance;
}

export async function readLibrariesByBoundingBox(
  connection: SQL,
  ranges: BoundingBox,
  origin: Location,
  limit: number,
  startingFrom: {
    urlId: string;
    direction: 'ascending' | 'descending';
  } | null,
): Promise<LibrariesByBoundingBox | null> {
  // This function composes 3 round trips from the web server to the PostgreSQL
  // server. This is much more legible than the many SQL fragments of d9b89.
  // We'll accept 3 round trips to avoid premature optimization, but they need
  // some level of transaction isolation.

  const originGeography = locationToGeography(connection, origin);

  // This is PostgreSQL's word for snapshot isolation. This is a read-only
  // query, so we want to be guaranteed that the data that's read is from a
  // "snapshot" of the database at a point in time.
  return connection.begin(
    'ISOLATION LEVEL REPEATABLE READ',
    async (transaction) => {
      const ascending =
        startingFrom === null || startingFrom.direction === 'ascending';
      const orderKeyword = ascending ? connection`ASC` : connection`DESC`;
      let cursor = null;
      if (startingFrom !== null) {
        const library = await readLibraryByUrlId(
          transaction,
          startingFrom.urlId,
        );
        if (library === null) {
          return null;
        }
        cursor = {
          urlId: library.urlId,
          distance: await spheroidDistance(
            transaction,
            origin,
            library.location,
          ),
          operator: ascending ? connection`>` : connection`<`,
        };
      }
      return readLibraryTuplesByBoundingBox(
        (db) => db`
        SELECT
          id,
          created_at,
          created_by,
          url_id,
          ST_AsGeoJson(location) as location,
          title,
          description,
          osm_element_id,
          ST_Distance(${originGeography}, location) as distance
        `,
        (db) =>
          cursor === null
            ? db``
            : db`
              AND (
                (ST_Distance(${originGeography}, location), url_id)
                  ${cursor.operator}
                  (${cursor.distance}, ${cursor.urlId})
              )
            `,
        (db) => db`
          ORDER BY
            (ST_Distance(${originGeography}, location), url_id)
            ${orderKeyword}
          LIMIT ${limit};
        `,
        rowToLibraryWithDistance,
        connection,
        ranges,
      ).then((libraries) => {
        const ascendingLibraries = ascending
          ? libraries
          : libraries.toReversed();
        return {
          libraries: ascendingLibraries,
          cursor:
            ascendingLibraries.length > 0
              ? {
                  ascending:
                    ascendingLibraries[ascendingLibraries.length - 1].urlId,
                  descending: ascendingLibraries[0].urlId,
                }
              : { ascending: null, descending: null },
        };
      });
    },
  );
}
