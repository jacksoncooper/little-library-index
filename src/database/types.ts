// These minimal error classes are taken from
// "JavaScript: The Definitive Guide" 7th Edition (p. 305). Ideally, this
// application doesn't throw because exception handling is invisible to control
// flow. The following errors all represent programming errors, meaning that if
// they trip something is seriously wrong. If this list continues to grow,
// it's a sign I'm not thinking through the application design well.
//
// Thrown when the contents of the database don't match what's expected. This
// should never happen unless (1) the schema changes or (2) Bun's interface
// with the database changes.
export class QueryShapeError extends Error {}
// Thrown when the TypeScript APIs that interface with the database cannot
// execute the query because the arguments are invalid. Ideally, the type
// system would prevent an invalid argument, but that's not always possible
// in practice.
export class InvalidQueryRequestError extends Error {}

export type WithPrimaryKey<T> = { id: number } & T;

// By default, Bun’s SQL client returns query results as arrays of objects,
// where each object represents a row with column names as keys.
// -- https://bun.com/docs/runtime/sql#query-results
export type Row = { [column: string]: unknown };

type Primitive = 'string' | 'number' | 'bigint';
type Constructor = ArrayConstructor | DateConstructor;
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

export function assertColumn<
  K extends string,
  T extends ColumnType,
  N extends boolean = false,
>(
  row: Row,
  property: K,
  expectedType: T,
  // TODO: The cast is necessary here, because TypeScript is worried that `N`
  // may be instantiated with a subtype where no member is `false`. One such
  // example is the literal `true`, which is a subtype of `boolean`, but not a
  // subtype of the literal `false`. If you explicitly pass the third type
  // argument as `true` but leave `nullable` defaulted, this becomes a problem.
  // This is an impractical edge case.
  nullable: N = false as N,
): asserts row is Row &
  Record<K, N extends true ? TypeOfType<T> | null : TypeOfType<T>> {
  if (!Object.prototype.hasOwnProperty.call(row, property)) {
    throw new QueryShapeError(`expected row to have property '${property}'`);
  }

  const column = row[property];

  if (nullable && column === null) {
    return;
  }

  if (isConstructor(expectedType)) {
    if (!(column instanceof expectedType)) {
      throw new QueryShapeError(
        `expected row to have property '${property}'` +
          ` of type ${expectedType.name}; got ${typeof column}`,
      );
    }
  } else {
    if (typeof column !== expectedType) {
      throw new QueryShapeError(
        `expected row to have property '${property}'` +
          ` of type ${expectedType.toString()}; got ${typeof column}`,
      );
    }
  }
}
