# littlelibraryindex.com

## Project planning

- **OpenStreetMap**: Lending libraries [have an `amenity` tag with the value `public_bookcase`](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dpublic_bookcase). We'd eventually like to contribute libraries registered with the application back to OpenStreetMap. For now, we can use this data source to populate useful information about lending libraries that users add, like `description` and `opening_hours`. Other cool amenities: `give_box` and `public_art_gallery`.

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
