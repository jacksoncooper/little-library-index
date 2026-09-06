import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  Book,
  createBook,
  editBook,
  NewBook,
  readBookByUrlId,
  rowToBook,
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
  return {
    id: rows[0].id,
    urlId: rows[0].url_id,
  };
}

function readBooks(connection: SQL): Promise<Row[]> {
  return connection<Row[]>`
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
    ORDER BY books.id;
  `;
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

describe('createBook()', () => {
  test('insert a new book with an Open Library ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const lateThisEvening = new Date(Date.UTC(2026, 7, 31, 0, 0, 0));

      const newBook: NewBook = {
        urlId: 'n0r3ll',
        created: {
          by: jacksonId,
          at: lateThisEvening,
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
      };

      const newBookId = await createBook(db, newBook);
      const expectedBook: WithPrimaryKey<Book> = {
        ...newBook,
        id: newBookId,
        version: 1,
        lastEdited: null,
      };

      const rows = await readBooks(db);
      assertRowCount(rows, 1);
      expect(expectedBook).toEqual(rowToBook(rows[0]));
    }));

  test('insert a new book without an Open Library ID', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const jacksonId = await createUser(db, { handle: 'jackson' });
      const lateThisEvening = new Date(Date.UTC(2026, 7, 31, 0, 0, 0));

      const newBook: NewBook = {
        urlId: 'f4ls3a',
        created: {
          at: lateThisEvening,
          by: jacksonId,
        },
        openLibraryId: null,
        title: 'Techno Primitivism Issue 2: False Archaeologies',
        author: 'Rachael Jackson',
        language: 'eng',
        publisher: 'Special Effects',
        publishDate: 'MMXXV',
        description: null,
      };

      const newBookId = await createBook(db, newBook);
      const expectedBook: WithPrimaryKey<Book> = {
        ...newBook,
        id: newBookId,
        version: 1,
        lastEdited: null,
      };

      const rows = await readBooks(db);
      assertRowCount(rows, 1);
      expect(expectedBook).toEqual(rowToBook(rows[0]));
    }));
});

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
