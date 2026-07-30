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

async function createUser(db: SQL, handle: string): Promise<number> {
    const rows = await db<Row[]>`
        INSERT INTO users ( handle )
        VALUES (${handle})
        RETURNING id
    `;
    assertRowCount(rows, 1);
    const column = rows[0];
    assertColumn(column, 'id', 'number');
    return column.id;
}

// Used to handle a request for a user profile. For example,
//
//   https://littlelibraryindex.com/user/jackson
//
function readUser(db: SQL, handle: string): Promise< WithPrimaryKey< User > > {
    return Promise.resolve( { id: 1, handle: 'jackson' } );
}
