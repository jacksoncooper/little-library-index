import { SQL } from 'bun';

import { UserAttribution, validateUserAttribution, Versioned } from './common';
import {
  assertColumn,
  assertRowCount,
  QueryShapeError,
  Row,
  WithPrimaryKey,
} from './types';

export type Isbn = {
  isbn13: string;
  sourceFormat: 'isbn_10' | 'isbn_13';
  bookId: number;
};

export type OpenLibraryId = {
  workId: string | null;
  editionId: string;
  authorId: string | null;
};

export type NewBook = {
  urlId: string;
  created: UserAttribution;
  openLibraryId: OpenLibraryId | null;
  title: string;
  author: string | null;
  // ISO 639-2 language code, see https://w.wiki/EXG.
  language: string | null;
  publisher: string | null;
  publishDate: string | null;
  description: string | null;
};

export type Book = Versioned<NewBook>;

export function rowToBook(row: Row): WithPrimaryKey<Book> {
  assertColumn(row, 'id', 'number');
  assertColumn(row, 'created_at', Date);
  assertColumn(row, 'created_by', 'number');
  assertColumn(row, 'version', 'number');
  assertColumn(row, 'last_edited_at', Date, true);
  assertColumn(row, 'last_edited_by', 'number', true);
  assertColumn(row, 'url_id', 'string');
  assertColumn(row, 'open_library_work_id', 'string', true);
  assertColumn(row, 'open_library_edition_id', 'string', true);
  assertColumn(row, 'open_library_author_id', 'string', true);
  assertColumn(row, 'title', 'string');
  assertColumn(row, 'author', 'string', true);
  assertColumn(row, 'iso_639_2', 'string', true);
  assertColumn(row, 'publisher', 'string', true);
  assertColumn(row, 'publish_date', 'string', true);
  assertColumn(row, 'description', 'string', true);

  // If we've written it correctly, the database constraint gives us that both
  // the work and author ID cannot exist without the edition ID.
  if (
    (row.open_library_work_id !== null ||
      row.open_library_author_id !== null) &&
    !row.open_library_edition_id
  ) {
    throw new QueryShapeError(
      `when an Open Library work ID (${row.open_library_work_id}) or` +
        ` author ID (${row.open_library_author_id}) are present, the edition ID` +
        ` is also present`,
    );
  }

  const openLibraryId = row.open_library_edition_id
    ? {
        workId: row.open_library_work_id,
        editionId: row.open_library_edition_id,
        authorId: row.open_library_author_id,
      }
    : null;

  const lastEdited = validateUserAttribution(
    row.last_edited_at,
    row.last_edited_by,
  );

  return {
    id: row.id,
    created: {
      at: row.created_at,
      by: row.created_by,
    },
    version: row.version,
    lastEdited,
    urlId: row.url_id,
    openLibraryId,
    title: row.title,
    author: row.author,
    language: row.iso_639_2,
    publisher: row.publisher,
    publishDate: row.publish_date,
    description: row.description,
  };
}

export async function createBook(
  connection: SQL,
  book: NewBook,
): Promise<number> {
  const result = await connection<Row[]>`
    INSERT INTO books (
      created_at,
      created_by,
      url_id,
      open_library_work_id,
      open_library_edition_id,
      open_library_author_id,
      title,
      author,
      iso_639_2,
      publisher,
      publish_date,
      description
    )
    VALUES (
      ${book.created.at},
      ${book.created.by},
      ${book.urlId},
      ${book.openLibraryId && book.openLibraryId.workId},
      ${book.openLibraryId && book.openLibraryId.editionId},
      ${book.openLibraryId && book.openLibraryId.authorId},
      ${book.title},
      ${book.author},
      ${book.language},
      ${book.publisher},
      ${book.publishDate},
      ${book.description}
    )
    RETURNING id;
  `;

  assertRowCount(result, 1);
  assertColumn(result[0], 'id', 'number');
  return result[0].id;
}

export async function readBookByUrlId(
  connection: SQL,
  urlId: string,
): Promise<WithPrimaryKey<Book> | null> {
  const rows = await connection<Row[]>`
    SELECT
      id,
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
    FROM books
    WHERE url_id = ${urlId}
  `;

  if (rows.length < 1) {
    return null;
  }
  assertRowCount(rows, 1); // The `url_id` column is unique.

  const row = rows[0];
  return rowToBook(row);
}
