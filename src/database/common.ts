export type UserAttribution = {
  at: Date;
  by: number;
};

export type Versioned<T> = T & {
  version: number;
  lastEdited: UserAttribution | null;
};
