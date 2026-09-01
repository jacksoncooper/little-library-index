import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Book, createBook, NewBook } from '../src/database/books';
import { assertColumn, assertRowCount, Row } from '../src/database/types';
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
          editionId: 'OL51145909M',
          workId: 'OL37888263W',
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
      const expectedBook: Book = {
        ...newBook,
        version: 1,
        lastEdited: null,
      };

      const rows = await readBooks(db);
      assertRowCount(rows, 1);

      const bookInDb = rows[0];
      assertColumn(bookInDb, 'id', 'number');
      assertColumn(bookInDb, 'created_at', Date);
      assertColumn(bookInDb, 'created_by', 'number');
      assertColumn(bookInDb, 'version', 'number');
      assertColumn(bookInDb, 'last_edited_at', Date, true);
      assertColumn(bookInDb, 'last_edited_by', 'number', true);
      assertColumn(bookInDb, 'url_id', 'string');
      assertColumn(bookInDb, 'open_library_work_id', 'string', true);
      assertColumn(bookInDb, 'open_library_edition_id', 'string');
      assertColumn(bookInDb, 'open_library_author_id', 'string', true);
      assertColumn(bookInDb, 'title', 'string');
      assertColumn(bookInDb, 'author', 'string', true);
      assertColumn(bookInDb, 'iso_639_2', 'string', true);
      assertColumn(bookInDb, 'publisher', 'string', true);
      assertColumn(bookInDb, 'publish_date', 'string', true);
      assertColumn(bookInDb, 'description', 'string', true);

      expect(bookInDb.last_edited_at).toBeNull();
      expect(bookInDb.last_edited_by).toBeNull();

      expect(newBookId).toEqual(bookInDb.id);
      expect(expectedBook).toEqual({
        urlId: bookInDb.url_id,
        created: {
          at: bookInDb.created_at,
          by: bookInDb.created_by,
        },
        openLibraryId: {
          workId: bookInDb.open_library_work_id,
          editionId: bookInDb.open_library_edition_id,
          authorId: bookInDb.open_library_author_id,
        },
        version: bookInDb.version,
        lastEdited: null,
        title: bookInDb.title,
        author: bookInDb.author,
        language: bookInDb.iso_639_2,
        publisher: bookInDb.publisher,
        publishDate: bookInDb.publish_date,
        description: bookInDb.description,
      });
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
      const expectedBook: Book = {
        ...newBook,
        version: 1,
        lastEdited: null,
      };

      const rows = await readBooks(db);
      assertRowCount(rows, 1);

      const bookInDb = rows[0];
      assertColumn(bookInDb, 'id', 'number');
      assertColumn(bookInDb, 'created_at', Date);
      assertColumn(bookInDb, 'created_by', 'number');
      assertColumn(bookInDb, 'version', 'number');
      assertColumn(bookInDb, 'last_edited_at', Date, true);
      assertColumn(bookInDb, 'last_edited_by', 'number', true);
      assertColumn(bookInDb, 'url_id', 'string');
      assertColumn(bookInDb, 'open_library_work_id', 'string', true);
      assertColumn(bookInDb, 'open_library_edition_id', 'string');
      assertColumn(bookInDb, 'open_library_author_id', 'string', true);
      assertColumn(bookInDb, 'title', 'string');
      assertColumn(bookInDb, 'author', 'string', true);
      assertColumn(bookInDb, 'iso_639_2', 'string', true);
      assertColumn(bookInDb, 'publisher', 'string', true);
      assertColumn(bookInDb, 'publish_date', 'string', true);
      assertColumn(bookInDb, 'description', 'string', true);

      expect(bookInDb.open_library_work_id).toBeNull();
      expect(bookInDb.open_library_edition_id).toBeNull();
      expect(bookInDb.open_library_author_id).toBeNull();

      expect(bookInDb.last_edited_at).toBeNull();
      expect(bookInDb.last_edited_by).toBeNull();

      expect(newBookId).toEqual(bookInDb.id);
      expect(expectedBook).toEqual({
        urlId: bookInDb.url_id,
        created: {
          at: bookInDb.created_at,
          by: bookInDb.created_by,
        },
        openLibraryId: null,
        version: bookInDb.version,
        lastEdited: null,
        title: bookInDb.title,
        author: bookInDb.author,
        language: bookInDb.iso_639_2,
        publisher: bookInDb.publisher,
        publishDate: bookInDb.publish_date,
        description: bookInDb.description,
      });
    }));
});
