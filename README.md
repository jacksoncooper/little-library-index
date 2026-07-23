# littlelibraryindex.com

## Project notes

- **OpenStreetMap**: Lending libraries [have an `amenity` tag with the value `public_bookcase`](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dpublic_bookcase). We'd eventually like to contribute libraries registered with the application back to OpenStreetMap. For now, we can use this data source to populate useful information about lending libraries that users add, like `description` and `opening_hours`. Other cool amenities: `give_box` and `public_art_gallery`.

## Features

### v1

- [ ] Users can add lending libraries.
- [ ] Users can mark books in lending libraries as "here" or "not here". ISBN input is manual.
- [ ] User transactions will be associated with a "username", but any user can associate a transaction with any username. This username will form the backbone of an identity table for v2.
- [ ] `added_by` is a column of the `libraries` table that points to a row in the `users` table.
- [ ] Integration with Open Library for a cover image, title, and author.

### v2

- [ ] Users can authenticate with Google.
- [ ] Users can mark a book as "here" and "not here" with their camera, by scanning the barcode that encodes the ISBN.
- [ ] Lending library data will be populated with the corresponding library from Open Street Map.
- [ ] Little Library Index will contibute lending libraries back to Open Street Map.
- [ ] Users can upload an image of lending libraries.
- [ ] Session mangement strategy?
- [ ] Server-side drafts of new libraries, so user progress is saved automatically. Independent of authentication.
- [ ] Deduplication of books without ISBNs, like zines.
- [ ] Localization strategy? ISO 639-2 language code for each book.
- [ ] Self host cover images for books without ISBN codes. Especially for things like zines.
- [ ] ISO 639.3 language support.

### v3

- [ ] Users can acquire a code, or purchase a sticker with a barcode, that allows a book to be tracked through the lending library network. Maybe they can participate in a conversation with only folks who have encountered that particular book.
- [ ] Profit!

## `bun create hono@latest`

To install dependencies:
```sh
bun install
```

To run:
```sh
bun run dev
```

open http://localhost:3000
