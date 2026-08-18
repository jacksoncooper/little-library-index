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
  const location = {
    type: 'Point',
    coordinates: [library.location.longitude, library.location.latitude],
  };
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
      ST_GeomFromGeoJSON(${location}::jsonb)::geography,
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

function rowToLibrary(row: Row): WithPrimaryKey<Library> {
  assertColumn(row, 'id', 'number');
  assertColumn(row, 'created_at', Date);
  assertColumn(row, 'created_by', 'number');
  assertColumn(row, 'url_id', 'string');
  assertColumn(row, 'location', 'string');
  assertColumn(row, 'title', 'string', true);
  assertColumn(row, 'description', 'string', true);
  assertColumn(row, 'osm_element_id', 'number', true);

  // A nifty hack here, where we treat the parsed JSON as equivalent to a row
  // from a Postgres table. They're both an untyped object.
  const point = JSON.parse(row.location) as Row;
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

  return {
    id: row.id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    urlId: row.url_id,
    location,
    title: row.title,
    description: row.description,
    osmElementId: row.osm_element_id,
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

export async function readLibrariesByBoundingBox(
  connection: SQL,
  ranges: BoundingBox,
): Promise<Library[]> {
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

  const [start, end] = ranges.longitude;
  if (start <= end) {
    validateLongitudeRange([start, end]);
  } else {
    validateLongitudeRange([end, start]);
  }

  const [south, north] = ranges.latitude;
  validateLatitudeRange([south, north]);

  if (start < end) {
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
      WHERE
        -- This cast is interesting. Sonnet 5 discovered that PostGIS' &&
        -- operator with geography operands is only an approximate check of the
        -- intersection between two bounding boxes that gets worse with an
        -- absolute increase in latitude. The && operator used by the query
        -- planner to exclude points as an initial pass. So, && must never
        -- produce a false negative. Luckily, a point within a bounding box
        -- doesn't require the extra power of the geometry type.
        location::geometry
        && ST_MakeEnvelope(${start}, ${south}, ${end}, ${north}, 4326)
    `;
    return rows.map((r) => rowToLibrary(r));
  } else {
    // The bounding box crosses the anti-meridian, and needs to be split into
    // two calls to `ST_MakeEnvelope`.
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
      WHERE
        (location::geometry
          && ST_MakeEnvelope(-180, ${south}, ${end}, ${north}, 4326))
        OR
        (location::geometry
          && ST_MakeEnvelope(${start}, ${south}, 180, ${north}, 4326))
    `;
    return rows.map((r) => rowToLibrary(r));
  }
}
