import { QueryShapeError } from './types';

export function validateUserAttribution(
  at: Date | null,
  by: number | null,
): UserAttribution | null {
  if (at === null && by === null) {
    return null;
  }
  if (at !== null && by !== null) {
    return { at, by };
  }
  throw new QueryShapeError(
    'expect both elements of user attribution to be present or absent',
  );
}

export type UserAttribution = {
  at: Date;
  by: number;
};

export type Versioned<T> = T & {
  version: number;
  lastEdited: UserAttribution | null;
};
