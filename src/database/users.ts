import {
    QueryShapeError,
    Row,
    WithPrimaryKey,
    assertColumn,
    assertRowCount,
    db
} from './connection';

type User = {
    handle: string
};

async function createUser(handle: string): Promise<number> {
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

function readUser(handle: string): Promise< WithPrimaryKey< User > > {
    return Promise.resolve( { id: 1, handle: 'jackson' } );
}
