import { SQL } from 'bun';

export type WithPrimaryKey<T> = (
    { id : number } & T
);

// By default, Bun’s SQL client returns query results as arrays of objects,
// where each object represents a row with column names as keys.
// -- https://bun.com/docs/runtime/sql#query-results
export type Row = { [column: string]: unknown };

type TypeOf = 'string' | 'number';

type TypeOfType<T extends TypeOf> =
    T extends 'string'
        ? string :
        number;

// "JavaScript: The Definitive Guide" 7th Edition (p. 305)
export class QueryShapeError extends Error { };

export const db = new SQL({
    adapter: 'postgres',
    database: 'little-library-index',
});

export function assertRowCount(rows: Row[], expected: number): void {
    if (rows.length !== expected) {
        throw new QueryShapeError(
            `expected ${expected} rows but got ${rows.length}`);
    }
}

export function assertColumn<K extends string, T extends TypeOf>(
    row: Row,
    property: K,
    expectedType: T,
): asserts row is Row & Record< K, TypeOfType<T>> {
    if (!row.hasOwnProperty(property)) {
        throw new QueryShapeError(
            `expected row to have property '${property}'`);
    }

    if (typeof row[property] !== expectedType) {
        throw new QueryShapeError(
            `expected row to have column '${property}' of type ${expectedType}`
        );
    }
}
