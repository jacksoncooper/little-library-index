import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  Book,
  createBook,
  createBookWithIsbn,
  editBook,
  IsbnToBook,
  NewBook,
  readBookByIsbn,
  readBookByUrlId,
  rowToBook,
  rowToIsbn,
} from '../src/database/books';
import {
  assertColumn,
  assertRowCount,
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

async function writeBookWithoutOpenLibraryId(
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

async function writeBookWithOpenLibraryId(
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

async function readBooks(connection: SQL): Promise<WithPrimaryKey<Book>[]> {
  return (
    await connection<Row[]>`
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
      ORDER BY id;
  `
  ).map(rowToBook);
}

async function readIsbns(
  connection: SQL,
): Promise<WithPrimaryKey<IsbnToBook>[]> {
  return (
    await connection<Row[]>`
      SELECT
        id,
        isbn_13,
        source_format,
        book_id
      FROM isbns
      ORDER BY id;
    `
  ).map(rowToIsbn);
}

describe('readBookByUrlId()', () => {
  test('read a book with an Open Library ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const delaneyId = await createUser(db, { handle: 'delaney' });

      const bookIds = await writeBookWithOpenLibraryId(
        db,
        jacksonId,
        delaneyId,
      );

      const book = await readBookByUrlId(db, bookIds.urlId);

      expect(book).toEqual({
        id: bookIds.id,
        urlId: 'n0r3ll',
        created: {
          by: jacksonId,
          at: new Date(Date.UTC(2026, 7, 31, 0, 0, 0)),
        },
        version: 2,
        lastEdited: {
          by: delaneyId,
          at: new Date(Date.UTC(2026, 8, 1, 0, 0, 0)),
        },
        openLibraryId: {
          workId: 'OL37888263W',
          editionId: 'OL51145909M',
          authorId: 'OL1387961A',
        },
        title: 'The Wood at Midwinter',
        author: 'Susanna Clarke',
        language: 'eng',
        publisher: 'Bloomsbury Publishing USA',
        publishDate: '2024',
        description: null,
      });
    }));

  test('read a book without an Open Library ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });

      const bookIds = await writeBookWithoutOpenLibraryId(db, jacksonId);

      const book = await readBookByUrlId(db, bookIds.urlId);

      expect(book).toEqual({
        id: bookIds.id,
        urlId: 'f4ls3a',
        created: {
          at: new Date(Date.UTC(2026, 7, 31, 0, 0, 0)),
          by: jacksonId,
        },
        version: 1,
        lastEdited: null,
        openLibraryId: null,
        title: 'Techno Primitivism Issue 2: False Archaeologies',
        author: 'Rachael Jackson',
        language: 'eng',
        publisher: 'Special Effects',
        publishDate: 'MMXXV',
        description: null,
      });
    }));

  test("try to read a book with a URL ID that doesn't exist", () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const delaneyId = await createUser(db, { handle: 'delaney' });

      await writeBookWithOpenLibraryId(db, jacksonId, delaneyId);
      await writeBookWithoutOpenLibraryId(db, jacksonId);

      const book = await readBookByUrlId(db, 'dn3dn3');
      expect(book).toBeNull();
    }));
});

function makeBookWithOpenLibraryId(
  userId: number,
  urlId: string,
  editionId: string,
): NewBook {
  return {
    urlId,
    created: {
      by: userId,
      at: new Date(Date.UTC(2026, 7, 31, 0, 0, 0)),
    },
    openLibraryId: {
      workId: 'OL37888263W',
      editionId,
      authorId: 'OL1387961A',
    },
    title: 'The Wood at Midwinter',
    author: 'Susanna Clarke',
    language: 'eng',
    publisher: 'Bloomsbury Publishing USA',
    publishDate: '2024',
    description: null,
  };
}

function makeBookWithoutOpenLibraryId(userId: number): NewBook {
  return {
    urlId: 'f4ls3a',
    created: {
      at: new Date(Date.UTC(2026, 7, 31, 0, 0, 0)),
      by: userId,
    },
    openLibraryId: null,
    title: 'Techno Primitivism Issue 2: False Archaeologies',
    author: 'Rachael Jackson',
    language: 'eng',
    publisher: 'Special Effects',
    publishDate: 'MMXXV',
    description: null,
  };
}

describe('createBook()', () => {
  test('insert a new book with an Open Library ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });

      const newBook = makeBookWithOpenLibraryId(
        jacksonId,
        'n0r3ll',
        'OL51145909M',
      );
      const { id, ...actualBook } = await createBook(db, newBook);
      const expectedBook: Book = {
        ...newBook,
        version: 1,
        lastEdited: null,
      };

      expect(actualBook).toEqual(expectedBook);

      // If `createBook` is malicious, it could return its parameter without
      // mutating the database. We assert its side effect here.
      const books = await readBooks(db);
      expect(books).toHaveLength(1);
      expect({ id, ...actualBook }).toEqual(books[0]);
    }));

  test('insert a new book without an Open Library ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });

      const newBook = makeBookWithoutOpenLibraryId(jacksonId);
      const { id, ...actualBook } = await createBook(db, newBook);
      const expectedBook: Book = {
        ...newBook,
        version: 1,
        lastEdited: null,
      };

      expect(actualBook).toEqual(expectedBook);

      const books = await readBooks(db);
      expect(books).toHaveLength(1);
      expect({ id, ...actualBook }).toEqual(books[0]);
    }));

  test('insert a new book with a duplicate URL ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });

      const newBook = makeBookWithoutOpenLibraryId(jacksonId);
      const { id } = await createBook(db, newBook);
      const expectedBook: WithPrimaryKey<Book> = {
        ...newBook,
        id,
        version: 1,
        lastEdited: null,
      };

      const modifiedBook = {
        ...newBook,
        description: 'Issue 02 concentrates on false archaeologies...',
      };
      const actualBook = await createBook(db, modifiedBook);

      expect(actualBook).toEqual(expectedBook);

      // The original record should be unchanged. We've changed the description
      // of the record for the second insertion, and it should not appear in
      // the database.
      const books = await readBooks(db);
      expect(books).toHaveLength(1);
      expect(actualBook).toEqual(books[0]);
    }));

  test('insert a new book with a duplicate Open Library ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });

      const newBook = makeBookWithOpenLibraryId(
        jacksonId,
        'n0r3ll',
        'OL51145909M',
      );
      const { id } = await createBook(db, newBook);
      const expectedBook: WithPrimaryKey<Book> = {
        ...newBook,
        id,
        version: 1,
        lastEdited: null,
      };

      const modifiedBook = {
        ...newBook,
        urlId: 'str4ng',
        description: 'Nineteen-year-old Merowdis Scott is an unusual girl...',
      };
      const actualBook = await createBook(db, modifiedBook);

      expect(actualBook).toEqual(expectedBook);

      // The original record should be unchanged. We've changed the description
      // of the record for the second insertion, and it should not appear in
      // the database.
      const books = await readBooks(db);
      expect(books).toHaveLength(1);
      expect(actualBook).toEqual(books[0]);
    }));
});

// TODO: This suite should verify that `editBook` actually mutates the database.
describe('editBook()', () => {
  test('try to edit a current book with an Open Library ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const delaneyId = await createUser(db, { handle: 'delaney' });

      const bookIds = await writeBookWithOpenLibraryId(
        db,
        jacksonId,
        delaneyId,
      );

      const book = await readBookByUrlId(db, bookIds.urlId);
      expect(book).not.toBeNull();

      const editedBook = {
        ...book!,
        title: 'The Mocking Midsummer Woodjay',
        author: 'Suzanne Collins',
        version: book!.version,
      };

      const result = await editBook(db, editedBook, {
        by: jacksonId,
        at: new Date(Date.UTC(2026, 8, 5, 22, 40, 0)),
      });

      expect(result).not.toBeNull();
      // A book with an Open Library ID cannot be edited.
      expect(result).toEqual(book);
    }));

  test('edit a current book without an Open Library ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const delaneyId = await createUser(db, { handle: 'delaney' });

      const bookIds = await writeBookWithoutOpenLibraryId(db, jacksonId);

      const book = await readBookByUrlId(db, bookIds.urlId);
      expect(book).not.toBeNull();

      const editedBook = {
        ...book!,
        title: 'Techno Primitivism Issue 1: Anthropological Indexicality',
        publishDate: 'MMXXIV',
        version: book!.version,
      };

      const result = await editBook(db, editedBook, {
        by: delaneyId,
        at: new Date(Date.UTC(2026, 8, 5, 22, 40, 0)),
      });

      expect(result).not.toBeNull();
      expect(result).toEqual({
        ...editedBook,
        lastEdited: {
          at: new Date(Date.UTC(2026, 8, 5, 22, 40, 0)),
          by: delaneyId,
        },
        version: book!.version + 1,
      });
    }));

  test("edit a book that isn't current", () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const delaneyId = await createUser(db, { handle: 'delaney' });

      const bookIds = await writeBookWithoutOpenLibraryId(db, jacksonId);

      const book = await readBookByUrlId(db, bookIds.urlId);
      expect(book).not.toBeNull();

      // Oops! Someone beat Delaney to the update.
      await db`
        UPDATE books
        SET version = ${book!.version + 1} WHERE url_id = ${book!.urlId}
      `;

      const editedBook = {
        ...book!,
        title: 'Techno Primitivism Issue 1: Anthropological Indexicality',
        publishDate: 'MMXXIV',
        version: book!.version,
      };

      const result = await editBook(db, editedBook, {
        by: delaneyId,
        at: new Date(Date.UTC(2026, 8, 5, 22, 40, 0)),
      });

      expect(result).not.toBeNull();
      expect(result).toEqual({
        ...book!,
        version: book!.version + 1,
      });
    }));

  test("edit a book that doesn't exist", () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const delaneyId = await createUser(db, { handle: 'delaney' });

      const bookIds = await writeBookWithoutOpenLibraryId(db, jacksonId);

      const book = await readBookByUrlId(db, bookIds.urlId);
      expect(book).not.toBeNull();

      const editedBook = {
        ...book!,
        urlId: 'f3ls3a',
      };

      const result = await editBook(db, editedBook, {
        by: delaneyId,
        at: new Date(Date.UTC(2026, 8, 5, 22, 40, 0)),
      });

      expect(result).toBeNull();
    }));
});

describe('createBookWithIsbn()', () => {
  test("create a book with an ISBN that doesn't already exist", () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });

      const newBook = makeBookWithOpenLibraryId(
        jacksonId,
        'n0r3ll',
        'OL51145909M',
      );
      const book = await createBookWithIsbn(
        db,
        { isbn: '9781639734481', sourceFormat: 'isbn_13' },
        newBook,
      );

      const booksInDb = await readBooks(db);
      expect(booksInDb).toHaveLength(1);
      expect(book).toEqual(booksInDb[0]);

      const isbnToBooksInDb = await readIsbns(db);
      expect(isbnToBooksInDb).toHaveLength(1);
      expect(isbnToBooksInDb[0]).toEqual({
        id: isbnToBooksInDb[0].id,
        isbn: {
          isbn: '9781639734481',
          sourceFormat: 'isbn_13',
        },
        bookId: booksInDb[0].id,
      });
    }));

  test('create a book with an ISBN that already exists', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const delaneyId = await createUser(db, { handle: 'delaney' });

      // Uh oh, there's already a book in the database with this ISBN!
      await writeBookWithOpenLibraryId(db, jacksonId, delaneyId);

      const newBook = makeBookWithOpenLibraryId(
        jacksonId,
        // 'OL53273608M' is a different Open Library edition of the work
        // https://openlibrary.org/works/OL37888263W. It doesn't share an
        // ISBN (9781526675217 versus 9781639734481), but let's pretend it does
        // for the sake of this test.
        'str4ng',
        'OL53273608M',
      );
      const book = await createBookWithIsbn(
        db,
        { isbn: '9781639734481', sourceFormat: 'isbn_13' },
        newBook,
      );

      const booksInDb = await readBooks(db);
      expect(booksInDb).toHaveLength(1);
      // A book with this ISBN already exists in the database, so
      // `createBookWithIsbn` returns that record. The write of the 'str4ng'
      // book should be aborted.
      expect(book.urlId).not.toEqual('str4ng');
      expect(book).toEqual(booksInDb[0]);

      const isbnToBooksInDb = await readIsbns(db);
      expect(isbnToBooksInDb).toHaveLength(1);
      const { id, ...isbnToBook } = isbnToBooksInDb[0];
      expect(isbnToBook).toEqual({
        isbn: {
          isbn: '9781639734481',
          sourceFormat: 'isbn_13',
        },
        bookId: booksInDb[0].id,
      });
    }));

  test('create a book with an invalid ISBN', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });

      const newBook = makeBookWithOpenLibraryId(
        jacksonId,
        'n0r3ll',
        'OL51145909M',
      );
      await rejectsWithPostgresError(
        createBookWithIsbn(
          db,
          // The first digit of this ISBN has been mistranscribed: 9 -> 6! o:
          { isbn: '6781639734481', sourceFormat: 'isbn_13' },
          newBook,
        ),
        postgresError.check_violation,
      );

      // The database shouldn't have changed.
      expect(await readBooks(db)).toHaveLength(0);
      expect(await readIsbns(db)).toHaveLength(0);
    }));
});

describe('readBookByIsbn()', () => {
  test('retrieve a book by ISBN', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const delaneyId = await createUser(db, { handle: 'delaney' });

      const bookIds = await writeBookWithOpenLibraryId(
        db,
        jacksonId,
        delaneyId,
      );

      const book = await readBookByIsbn(db, '9781639734481');

      expect(book).toEqual({
        id: bookIds.id,
        urlId: 'n0r3ll',
        created: {
          by: jacksonId,
          at: new Date(Date.UTC(2026, 7, 31, 0, 0, 0)),
        },
        version: 2,
        lastEdited: {
          by: delaneyId,
          at: new Date(Date.UTC(2026, 8, 1, 0, 0, 0)),
        },
        openLibraryId: {
          workId: 'OL37888263W',
          editionId: 'OL51145909M',
          authorId: 'OL1387961A',
        },
        title: 'The Wood at Midwinter',
        author: 'Susanna Clarke',
        language: 'eng',
        publisher: 'Bloomsbury Publishing USA',
        publishDate: '2024',
        description: null,
      });
    }));

  test("try to retrieve a book by an ISBN that doesn't exist", () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const delaneyId = await createUser(db, { handle: 'delaney' });

      await writeBookWithOpenLibraryId(db, jacksonId, delaneyId);

      // The first digit of this ISBN has been mistranscribed: 9 -> 6! o:
      const book = await readBookByIsbn(db, '6781639734481');

      expect(book).toBeNull();
    }));
});
