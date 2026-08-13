// "JavaScript: The Definitive Guide" 7th Edition (p. 305)
export class QueryShapeError extends Error {}

export type WithPrimaryKey<T> = { id: number } & T;

// By default, Bun’s SQL client returns query results as arrays of objects,
// where each object represents a row with column names as keys.
// -- https://bun.com/docs/runtime/sql#query-results
export type Row = { [column: string]: unknown };

type Primitive = 'string' | 'number' | 'bigint';
type Constructor = DateConstructor;
type ColumnType = Primitive | Constructor;

function isConstructor(value: ColumnType): value is Constructor {
  return typeof value !== 'string';
}

type TypeOfType<T extends ColumnType> = T extends Primitive
  ? T extends 'string'
    ? string
    : T extends 'number'
      ? number
      : bigint
  : T extends Constructor
    ? InstanceType<T>
    : never;

export function assertRowCount(rows: Row[], expected: number): void {
  if (rows.length !== expected) {
    throw new QueryShapeError(
      `expected ${expected} rows but got ${rows.length}`,
    );
  }
}

export function assertColumn<K extends string, T extends ColumnType>(
  row: Row,
  property: K,
  expectedType: T,
): asserts row is Row & Record<K, TypeOfType<T>> {
  if (!Object.prototype.hasOwnProperty.call(row, property)) {
    throw new QueryShapeError(
      `expected row to have property '${property}'`);
  }

  const column = row[property];

  if (isConstructor(expectedType)) {
    if (!(column instanceof expectedType)) {
      throw new QueryShapeError(
        `expected row to have property '${property}'`
        + ` of type ${expectedType.name}; got ${typeof column}`);
    }
  } else {
    if (typeof column !== expectedType) {
      throw new QueryShapeError(
        `expected row to have property '${property}'`
        + ` of type ${expectedType.toString()}; got ${typeof column}`);
    }
  }
}
