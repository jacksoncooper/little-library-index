import { SQL } from 'bun';
import {
    QueryShapeError,
    Row,
    WithPrimaryKey,
    assertColumn,
    assertRowCount,
} from './types';

type OsmElementType = 'node' | 'relation' | 'way';

type OsmElementId = {
    elementType: OsmElementType,
    elementId: bigint,
};

type Location = {
    latitude: number,
    longitude: number
};

export type Library = {
    createdAt: Date,
    createdBy: number,
    urlId: string,
    location: Location,
    title: string | null,
    description: string | null,
    accessibilityNotes: string | null,
    osmElementId: number | null,
};

export async function writeOsmElementId(
    connection: SQL,
    osmElementId: OsmElementId
): Promise<number> {
    return Promise.resolve(21);
}

export async function readOsmElementId(
    connection: SQL,
    id: number,
): Promise<WithPrimaryKey<OsmElementId> | null> {
    const rows = await connection<Row[]>`
        SELECT id, element_type, element_id FROM osm_element_ids
        WHERE id = ${id};
    `;

    if (rows.length < 1) {
        return null;
    }
    assertRowCount(rows, 1);

    const row = rows[0];
    assertColumn(row, 'id', 'number');
    assertColumn(row, 'element_type', 'string');
    assertColumn(row, 'element_id', 'string');

    if (!(
           row.element_type == 'node'
        || row.element_type == 'relation'
        || row.element_type == 'way'
    )) {
        throw new QueryShapeError(
            `expect '${row.element_type}' to be one of `
            + `'node', 'relation', 'way'`);
    }

    return {
        id: row.id,
        // TODO: The BigInt constructor will throw a `SyntaxError` if it cannot
        // parse its argument. MDN says "Strings are parsed as if they are
        // source text for integer literals," which explains the bizarre error
        // class.
        elementId: BigInt(row.element_id),
        elementType: row.element_type
    }
}

export async function writeLibrary(
    connection: SQL,
    library: Library
): Promise<number> {
    return Promise.resolve(42);
}

// Used to handle a request for a library. For example,
//
//   https://littlelibraryindex.com/library/o5c93c
//
export async function readLibraryByUrlId(
    connection: SQL,
    urlId: string
) : Promise<WithPrimaryKey<Library> | null> {
    return Promise.resolve(null);
}
