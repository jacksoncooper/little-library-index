import { SQL } from 'bun';

import { assertColumn, assertRowCount, Row } from '../src/database/types';

export async function writeLibraries(
  connection: SQL,
): Promise<{ id: number; createdBy: number; urlId: string }> {
  const rows = await connection<Row[]>`
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
  assertRowCount(rows, 1);
  const row = rows[0];
  assertColumn(row, 'id', 'number');
  assertColumn(row, 'created_by', 'number');
  assertColumn(row, 'url_id', 'string');
  return { id: row.id, createdBy: row.created_by, urlId: row.url_id };
}
