import { SQL } from 'bun';

import { UserAttribution } from './common';
import { assertColumn, assertRowCount, QueryShapeError, Row, WithPrimaryKey } from './types';

export enum InventoryEventType {
  CheckIn = 'check_in',
  CheckOut = 'check_out',
  Reconcile = 'reconcile',
}

function toInventoryEventType(eventType: string): InventoryEventType {
  // Although string enumerations in TypeScript are just strings at runtime,
  // `eslint`'s `no-unsafe-enum-comparison` prevents us from comparing a
  // `string` with a string enumeration.
  if (eventType === InventoryEventType.CheckIn.toString()) {
    return InventoryEventType.CheckIn;
  }
  if (eventType === InventoryEventType.CheckOut.toString()) {
    return InventoryEventType.CheckOut;
  }
  if (eventType === InventoryEventType.Reconcile.toString()) {
    return InventoryEventType.Reconcile;
  }
  throw new QueryShapeError(
    `expect '${eventType}' to be one of ` +
      `'${InventoryEventType.CheckIn}', ` +
      `'${InventoryEventType.CheckOut}}', ` +
      `or '${InventoryEventType.Reconcile}'`,
  );
}

export type InventoryEvent = {
  entered: UserAttribution;
  type: InventoryEventType;
  libraryId: number;
  bookId: number;
  delta: number;
  visible: boolean;
  handleIsVisible: boolean;
};

export type CheckInBookEvent = Omit<InventoryEvent, 'type'> & {
  type: InventoryEventType.CheckIn;
};

export function rowToInventoryEvent(row: Row): WithPrimaryKey<InventoryEvent> {
  assertColumn(row, 'id', 'number');
  assertColumn(row, 'entered_at', Date);
  assertColumn(row, 'entered_by', 'number');
  assertColumn(row, 'type', 'string');
  assertColumn(row, 'library_id', 'number');
  assertColumn(row, 'book_id', 'number');
  assertColumn(row, 'delta', 'number');
  assertColumn(row, 'visible', 'boolean');
  assertColumn(row, 'handle_is_visible', 'boolean');

  return {
    id: row.id,
    entered: {
      at: row.entered_at,
      by: row.entered_by,
    },
    type: toInventoryEventType(row.type),
    libraryId: row.library_id,
    bookId: row.book_id,
    delta: row.delta,
    visible: row.visible,
    handleIsVisible: row.handle_is_visible,
  };
}

export async function checkInBook(
  connection: SQL,
  event: CheckInBookEvent,
): Promise<WithPrimaryKey<CheckInBookEvent>> {
  const rows = await connection<Row[]>`
    INSERT INTO inventory_events (
      entered_at,
      entered_by,
      type,
      library_id,
      book_id,
      delta,
      visible,
      handle_is_visible
    )
    VALUES (
      ${event.entered.at},
      ${event.entered.by},
      ${event.type.toString()},
      ${event.libraryId},
      ${event.bookId},
      ${event.delta},
      ${event.visible},
      ${event.handleIsVisible}
    )
    RETURNING
      id,
      entered_at,
      entered_by,
      type,
      library_id,
      book_id,
      delta,
      visible,
      handle_is_visible;
  `;
  assertRowCount(rows, 1);
  const insertedEvent = rowToInventoryEvent(rows[0]);
  if (insertedEvent.type !== InventoryEventType.CheckIn) {
    throw new QueryShapeError(
      `expect event type of new row to be '${InventoryEventType.CheckIn}'`,
    );
  }
  return insertedEvent as WithPrimaryKey<CheckInBookEvent>;
}
