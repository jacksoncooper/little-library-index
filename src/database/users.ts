import { SQL } from 'bun';

import {
    Row,
    WithPrimaryKey,
    assertColumn,
    assertRowCount,
} from './types';

type User = {
    handle: string
};

export async function writeUser(db: SQL, handle: string): Promise<number> {
    const rows = await db<Row[]>`
        INSERT INTO users (handle)
        VALUES (${handle})
        RETURNING id;
    `;
    assertRowCount(rows, 1); // Only one row was inserted.
    const row = rows[0];
    assertColumn(row, 'id', 'number');
    return row.id;
}

// Used to handle a request for a user profile. For example,
//
//   https://littlelibraryindex.com/user/jackson
//
export async function readUser(
    db: SQL,
    handle: string
): Promise<WithPrimaryKey<User> | null> {
    const rows = await db<Row[]>`
        SELECT id, handle FROM users
        WHERE handle = ${handle};
    `;
    if (rows.length < 1) {
        return null;
    }
    assertRowCount(rows, 1); // The 'handle' column is unique.
    const row = rows[0];
    assertColumn(row, 'id', 'number');
    assertColumn(row, 'handle', 'string');
    return { id: row.id, handle: row.handle };
}
