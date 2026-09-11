import { SQL } from 'bun';

import {
  Result,
  UserAttribution,
  validateUserAttribution,
  Versioned,
} from './common';
import {
  assertColumn,
  assertRowCount,
  QueryShapeError,
  Row,
  WithPrimaryKey,
} from './types';

export type Isbn13 = {
  isbn: string;
  sourceFormat: 'isbn_10' | 'isbn_13';
};

export type IsbnToBook = {
  isbn: Isbn13;
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

type EditableBookProperties =
  'title' | 'author' | 'language' | 'publisher' | 'publishDate' | 'description';

export enum BooksConstraint {
  UrlIdConflict = 'url_id_is_unique',
  OpenLibraryEditionIdConflict = 'open_library_edition_id_is_unique',
}

type BooksOrIsbnConflict =
  | {
      table: 'books';
      conflict: BooksConstraint;
    }
  | {
      table: 'isbns';
      conflict: IsbnsConstraint;
    };

export enum IsbnsConstraint {
  Isbn13Conflict = 'isbn_13_is_unique',
}

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

export async function createBookOrError(
  connection: SQL,
  book: NewBook,
): Promise<Result<WithPrimaryKey<Book>, BooksConstraint>> {
  try {
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
      RETURNING
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
        description;
    `;
    assertRowCount(result, 1);
    return Result.okay(rowToBook(result[0]));
  } catch (error) {
    if (error instanceof SQL.PostgresError) {
      if (error.constraint === BooksConstraint.UrlIdConflict) {
        return Result.error(BooksConstraint.UrlIdConflict);
      } else if (
        error.constraint === BooksConstraint.OpenLibraryEditionIdConflict
      ) {
        return Result.error(BooksConstraint.OpenLibraryEditionIdConflict);
      }
    }
    throw error;
  }
}

export async function createIsbnOrError(
  connection: SQL,
  isbn: Isbn13,
  bookId: number,
): Promise<Result<void, IsbnsConstraint>> {
  try {
    await connection<void>`
      INSERT INTO isbns (
        isbn_13,
        source_format,
        book_id
      ) VALUES (
        ${isbn.isbn},
        ${isbn.sourceFormat},
        ${bookId}
      );
    `;
    return Result.okay(undefined);
  } catch (error) {
    if (error instanceof SQL.PostgresError) {
      if (error.constraint === IsbnsConstraint.Isbn13Conflict) {
        return Result.error(IsbnsConstraint.Isbn13Conflict);
      }
    }
    throw error;
  }
}

async function readBookByConflict(
  connection: SQL,
  book: NewBook,
  conflict: BooksConstraint,
): Promise<WithPrimaryKey<Book>> {
  if (conflict === BooksConstraint.UrlIdConflict) {
    const existingBook = await readBookByUrlId(connection, book.urlId);
    if (existingBook === null) {
      // As currently modeled, books cannot be deleted. So, if we cannot create
      // a new book because there's an existing book with the same URL ID,
      // it is a programming error if a query to read that book states that the
      // book doesn't exist.
      throw new QueryShapeError(
        `expect book with URL ID ${book.urlId} to exist`,
      );
    }
    return existingBook;
  } else {
    if (book.openLibraryId === null) {
      // If we cannot create a new book because there's an existing book with
      // the same Open Library ID, then it is a programming error for the
      // `book` parameter to not have an Open Library ID. The database should
      // treat NULL values as distinct.
      throw new QueryShapeError(
        `expect new book to have a non-null Open Library ID`,
      );
    }
    const existingBook = await readBookByOpenLibraryId(
      connection,
      book.openLibraryId,
    );
    if (existingBook === null) {
      throw new QueryShapeError(
        `expect book with Open Library edition ID ` +
          ` ${book.openLibraryId.editionId} to exist`,
      );
    }
    return existingBook;
  }
}

export async function createBook(
  connection: SQL,
  book: NewBook,
): Promise<WithPrimaryKey<Book>> {
  const maybeBook = await createBookOrError(connection, book);
  if (maybeBook.okay) {
    return maybeBook.result;
  }
  return readBookByConflict(connection, book, maybeBook.error);
}

export function readBookByUrlId(
  connection: SQL,
  urlId: string,
): Promise<WithPrimaryKey<Book> | null> {
  return readBookByUniqueProperty(connection, (db) => db`url_id = ${urlId}`);
}

export function readBookByOpenLibraryId(
  connection: SQL,
  openLibraryId: OpenLibraryId,
): Promise<WithPrimaryKey<Book> | null> {
  return readBookByUniqueProperty(
    connection,
    (db) => db`open_library_edition_id = ${openLibraryId.editionId}`,
  );
}

async function readBookByUniqueProperty(
  connection: SQL,
  whereClause: (db: SQL) => SQL.Query<unknown>,
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
    WHERE ${whereClause(connection)};
  `;

  if (rows.length < 1) {
    return null;
  }
  assertRowCount(rows, 1); // The where clause is assumed to query a unique row.

  const row = rows[0];
  return rowToBook(row);
}

export async function editBook(
  connection: SQL,
  book: Pick<Book, EditableBookProperties | 'urlId' | 'version'>,
  lastEdited: UserAttribution,
): Promise<WithPrimaryKey<Book> | null> {
  const rows = await connection<Row[]>`
    UPDATE books
    SET
      version = ${book.version + 1},
      last_edited_at = ${lastEdited.at},
      last_edited_by = ${lastEdited.by},
      title = ${book.title},
      author = ${book.author},
      iso_639_2 = ${book.language},
      publisher = ${book.publisher},
      publish_date = ${book.publishDate},
      description = ${book.description}
    WHERE
      url_id = ${book.urlId} AND version = ${book.version}
        -- The presence of an author ID or work ID imply the edition ID. So
        -- we only need to check for the edition ID. Books with Open Library
        -- IDs are synchronized with Open Library and cannot be edited, say,
        -- like a zine can.
        AND open_library_edition_id IS NULL
    RETURNING
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
      description;
  `;

  // This early return may look redundant, but it's not. If the update succeeds,
  // it's possible that a subsequent update could commit before we have the
  // opportunity to read the updated value.
  if (rows.length === 1) {
    const row = rows[0];
    return rowToBook(row);
  }

  return await readBookByUrlId(connection, book.urlId);
}

export async function readBookByIsbn(
  connection: SQL,
  isbn: string,
): Promise<WithPrimaryKey<Book> | null> {
  const rows = await connection<Row[]>`
    SELECT
      books.id,
      books.created_at, books.created_by,
      books.version, books.last_edited_at, books.last_edited_by,
      books.url_id,
      books.open_library_work_id,
      books.open_library_edition_id,
      books.open_library_author_id,
      books.title,
      books.author,
      books.iso_639_2,
      books.publisher,
      books.publish_date,
      books.description,
      isbns.isbn_13
    FROM isbns
    JOIN books ON isbns.book_id = books.id
    WHERE isbns.isbn_13 = ${isbn};
  `;

  if (rows.length < 1) {
    return null;
  }
  assertRowCount(rows, 1); // ISBNs are unique.

  const row = rows[0];
  return rowToBook(row);
}

export async function createBookWithIsbn(
  connection: SQL,
  isbn: Isbn13,
  book: NewBook,
): Promise<WithPrimaryKey<Book>> {
  const maybeBook = await connection.begin<
    Result<WithPrimaryKey<Book>, BooksOrIsbnConflict>
  >(async (trans) => {
    const maybeBook = await createBookOrError(trans, book);
    if (!maybeBook.okay) {
      return Result.error({ table: 'books', conflict: maybeBook.error });
    }
    const maybeIsbn = await createIsbnOrError(trans, isbn, maybeBook.result.id);
    if (!maybeIsbn.okay) {
      return Result.error({ table: 'isbns', conflict: maybeIsbn.error });
    }
    return Result.okay(maybeBook.result);
  });
  if (maybeBook.okay) {
    return maybeBook.result;
  }
  if (maybeBook.error.table === 'books') {
    return readBookByConflict(connection, book, maybeBook.error.conflict);
  }
  const existingBook = await readBookByIsbn(connection, isbn.isbn);
  if (existingBook === null) {
    throw new QueryShapeError(`expect book with ISBN ${isbn.isbn} to exist`);
  }
  return existingBook;
}

export function rowToIsbn(row: Row): WithPrimaryKey<IsbnToBook> {
  assertColumn(row, 'id', 'number');
  assertColumn(row, 'isbn_13', 'string');
  assertColumn(row, 'source_format', 'string');
  assertColumn(row, 'book_id', 'number');

  if (row.source_format !== 'isbn_10' && row.source_format !== 'isbn_13') {
    throw new QueryShapeError(
      `expect '${row.source_format}' to be one of 'isbn_10' or 'isbn_13'`,
    );
  }

  return {
    id: row.id,
    isbn: {
      isbn: row.isbn_13,
      sourceFormat: row.source_format,
    },
    bookId: row.book_id,
  };
}
