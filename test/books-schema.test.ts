import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Book, createBook, NewBook, rowToBook } from '../src/database/books';
import { assertRowCount, Row, WithPrimaryKey } from '../src/database/types';
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
