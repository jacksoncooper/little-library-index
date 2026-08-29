export type Isbn = {
  isbn13: string;
  sourceFormat: 'isbn_10' | 'isbn_13';
  bookId: number;
};
