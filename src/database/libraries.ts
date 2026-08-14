import { SQL } from 'bun';
import {
  QueryShapeError,
  Row,
  WithPrimaryKey,
  assertColumn,
  assertRowCount,
} from './types';

type OsmElementType = 'node' | 'relation' | 'way';

type OsmElementId = {
  elementType: OsmElementType;
  elementId: bigint;
};

type Location = {
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
  return Promise.resolve(42);
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
  assertColumn(row, 'id', 'number');
  assertColumn(row, 'created_at', Date);
  assertColumn(row, 'created_by', 'number');
  assertColumn(row, 'url_id', 'string');
  assertColumn(row, 'location', 'string');
  assertColumn(row, 'title', 'string', true);
  assertColumn(row, 'description', 'string', true);
  assertColumn(row, 'osm_element_id', 'number');

  const point = JSON.parse(row.location);
  assertColumn(point, 'coordinates', Array);
  if (point.coordinates.length != 2) {
   throw new QueryShapeError(
    'expect location to be two-dimensional,'
    + ` but got ${point.coordinates.length} dimensions`)
  }
  const location = {
    latitude: point.coordinates[1],
    longitude: point.coordinates[0]
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
  }
}
