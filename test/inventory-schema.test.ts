import { SQL } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  checkInBook,
  CheckInBookEvent,
  InventoryEvent,
  InventoryEventType,
  rowToInventoryEvent,
} from '../src/database/inventory';
import { Row, WithPrimaryKey } from '../src/database/types';
import { createUser } from '../src/database/users';
import {
  writeBookWithOpenLibraryId,
  writeBookWithoutOpenLibraryId,
} from './books-fixtures';
import {
  createTestDatabase,
  deleteTestDatabase,
  makeConnection,
  postgresError,
  rejectsWithPostgresError,
  withDatabaseConnection,
} from './connection';
import { writeLibraries } from './libraries-fixtures';

const testConnection = makeConnection();

beforeEach(async () => createTestDatabase(testConnection.name));

afterEach(async () =>
  // `dropdb` will fail if there are existing connections to the database.
  // `db` defines a connection pool of exactly those connections to the test
  // database. So, before we issue `dropdb`, we need to close the connections
  // that comprise the pool.
  deleteTestDatabase(testConnection.name),
);

async function readInventoryEvents(
  connection: SQL,
): Promise<WithPrimaryKey<InventoryEvent>[]> {
  return (
    await connection<Row[]>`
      SELECT
        id,
        entered_at, entered_by,
        type,
        library_id,
        book_id,
        delta,
        visible,
        handle_is_visible
      FROM inventory_events
      ORDER BY id;
  `
  ).map(rowToInventoryEvent);
}

describe('checkInBook()', () => {
  test('check in two books', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const winstonId = await createUser(db, { handle: 'winston' });

      const libraryIds = await writeLibraries(db);
      const librarianId = libraryIds.createdBy;

      const book1Ids = await writeBookWithOpenLibraryId(
        db,
        librarianId,
        librarianId,
      );
      const book2Ids = await writeBookWithoutOpenLibraryId(db, librarianId);

      const expectedFirstEvent: CheckInBookEvent = {
        entered: {
          at: new Date(Date.UTC(2026, 8, 21, 21, 21, 0)),
          by: winstonId,
        },
        type: InventoryEventType.CheckIn,
        libraryId: libraryIds.id,
        bookId: book1Ids.id,
        delta: 1,
        visible: true,
        handleIsVisible: true,
      };

      const expectedSecondEvent: CheckInBookEvent = {
        entered: {
          at: new Date(Date.UTC(2026, 8, 21, 21, 21, 0)),
          by: winstonId,
        },
        type: InventoryEventType.CheckIn,
        libraryId: libraryIds.id,
        bookId: book2Ids.id,
        delta: 4, // I've got a few copies of this zine.
        visible: true,
        handleIsVisible: true,
      };

      const { id: firstId, ...firstEvent } = await checkInBook(
        db,
        expectedFirstEvent,
      );
      const { id: secondId, ...secondEvent } = await checkInBook(
        db,
        expectedSecondEvent,
      );

      expect(firstEvent).toEqual(expectedFirstEvent);
      expect(secondEvent).toEqual(expectedSecondEvent);

      const eventsInDb = await readInventoryEvents(db);
      expect(eventsInDb).toHaveLength(2);

      // We assert the events are in the `inventory_events` table in the order
      // in which they were recorded.
      expect(eventsInDb[0]).toEqual({
        id: firstId,
        ...expectedFirstEvent,
      });
      expect(eventsInDb[1]).toEqual({
        id: secondId,
        ...expectedSecondEvent,
      });
    }));

  test('try to check in a book with a non-positive amount', () =>
    withDatabaseConnection(testConnection.open(), async (db) => {
      const winstonId = await createUser(db, { handle: 'winston' });

      const libraryIds = await writeLibraries(db);
      const librarianId = libraryIds.createdBy;

      const bookIds = await writeBookWithOpenLibraryId(
        db,
        librarianId,
        librarianId,
      );

      await rejectsWithPostgresError(
        checkInBook(db, {
          entered: {
            at: new Date(Date.UTC(2026, 8, 21, 21, 21, 0)),
            by: winstonId,
          },
          type: InventoryEventType.CheckIn,
          libraryId: libraryIds.id,
          bookId: bookIds.id,
          delta: 0,
          visible: true,
          handleIsVisible: true,
        }),
        postgresError.check_violation,
        'check_in_has_positive_delta',
      );

      const eventsInDb = await readInventoryEvents(db);
      expect(eventsInDb).toHaveLength(0);
    }));
});
