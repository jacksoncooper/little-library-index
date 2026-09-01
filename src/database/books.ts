import { SQL } from 'bun';

import { UserAttribution, Versioned } from './common';

export type Isbn = {
  isbn13: string;
  sourceFormat: 'isbn_10' | 'isbn_13';
  bookId: number;
};

export type OpenLibraryId = {
  workId: string | null;
  editionId: string;
  authorId: string | null;
};

export type NewBook = {
  urlId: string;
  created: UserAttribution;
  openLibraryId: OpenLibraryId | null;
  title: string;
  author: string | null;
  // ISO 639-2 language code, see https://w.wiki/EXG.
  language: string | null;
  publisher: string | null;
  publishDate: string | null;
  description: string | null;
};

export type Book = Versioned<NewBook>;

export function createBook(connection: SQL, book: NewBook): Promise<number> {
  return Promise.resolve(42);
}
