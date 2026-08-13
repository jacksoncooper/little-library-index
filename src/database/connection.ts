import { SQL } from 'bun';

export const prod = new SQL({
  adapter: 'postgres',
  database: 'little-library-index',
});
