import { SQL } from 'bun';

import { assertColumn, assertRowCount, Row } from '../src/database/types';

export async function writeBookWithoutOpenLibraryId(
  connection: SQL,
  createdBy: number,
): Promise<{ id: number; urlId: string }> {
  const rows = await connection<Row[]>`
    INSERT INTO books (
      created_at, created_by,
      version, last_edited_at, last_edited_by,
      url_id,
      open_library_work_id, open_library_edition_id, open_library_author_id,
      title,
      author,
      iso_639_2,
      publisher,
      publish_date,
      description
    ) VALUES (
      '2026-08-31 00:00:00 UTC', ${createdBy},
      1, null, null,
      'f4ls3a',
      null, null, null,
      'Techno Primitivism Issue 2: False Archaeologies',
      'Rachael Jackson',
      'eng',
      'Special Effects',
      'MMXXV',
      null
    )
    RETURNING id, url_id;
  `;
  assertRowCount(rows, 1);
  assertColumn(rows[0], 'id', 'number');
  assertColumn(rows[0], 'url_id', 'string');
  return {
    id: rows[0].id,
    urlId: rows[0].url_id,
  };
}

export async function writeBookWithOpenLibraryId(
  connection: SQL,
  createdBy: number,
  editedBy: number,
): Promise<{ id: number; urlId: string }> {
  const rows = await connection<Row[]>`
    INSERT INTO books (
      created_at, created_by,
      version, last_edited_at, last_edited_by,
      url_id,
      open_library_work_id, open_library_edition_id, open_library_author_id,
      title,
      author,
      iso_639_2,
      publisher,
      publish_date,
      description
    ) VALUES (
      '2026-08-31 00:00:00 UTC', ${createdBy},
      2, '2026-09-01 00:00:00 UTC', ${editedBy},
      'n0r3ll',
      'OL37888263W', 'OL51145909M', 'OL1387961A',
      'The Wood at Midwinter',
      'Susanna Clarke',
      'eng',
      'Bloomsbury Publishing USA',
      '2024',
      null
    )
    RETURNING id, url_id;
  `;
  assertRowCount(rows, 1);
  assertColumn(rows[0], 'id', 'number');
  assertColumn(rows[0], 'url_id', 'string');

  await connection<void>`
    INSERT INTO isbns (
      isbn_13,
      source_format,
      book_id
    )
    VALUES (
      '9781639734481',
      'isbn_13',
      ${rows[0].id}
    );
  `;

  return {
    id: rows[0].id,
    urlId: rows[0].url_id,
  };
}
