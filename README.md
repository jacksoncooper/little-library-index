# littlelibraryindex.com

An open source, free index of [lending libraries](https://en.wikipedia.org/wiki/Lending_library), maintained by its users. I'm interested in the kinds of giving economies described by Robin Wall Kimmerer in their book _The Serviceberry_, and my hope is that an accessible index will encourage more people to participate in lending libraries in our communities. If I can see that an interesting zine or novel was deposited at a library near me, for example, I'm more likely to interact with this awesome distributed library.

## Project status

- [x] A v1 Postgres schema
- [ ] A collection of TypeScript modules for carrying out user operations on the database
- [ ] An HTTP API for carrying out user operations on the database. In particular, this step serves the server-rendered HTML

## Project goals

At the moment, I'm a systems programmer, professionally. I'm interested in learning how web applications work. To this end,

- I'm using minimal JavaScript module dependencies: Bun, and Hono for the web server.
- I'm not using a front-end framework, because it's not justified by the scale of this project and because I want to learn the native DOM APIs first.
- I want to render HTML server-side, rather than client-side from server state. I like the idea of a lightweight client.
- I'm not using an ORM, because it's not justified by the scale of the project and because I want to interface with the database myself.
- Both client code and server will be written entirely in TypeScript, because type safety is wonderful.
- This project will never be vibe coded, but I use Anthropic's Sonnet 5 for design and testing.

## Project notes

- **OpenStreetMap**: Lending libraries [have an `amenity` tag with the value `public_bookcase`](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dpublic_bookcase). We'd eventually like to contribute libraries registered with the application back to OpenStreetMap. For now, we can use this data source to populate useful information about lending libraries that users add, like `description` and `opening_hours`. Other cool amenities: `give_box` and `public_art_gallery`.

## Features

### v1: The minimal viable product

- [ ] The minimal scope for v1 is 3 pages: (1) the home page, with a map showing libraries near you or, failing location services, a default view. Below, a list of those same libraries. Clicking on any takes you to the page for that library. To the right, a live feed of the recent transactions in that bounding box. (2) The library page, displaying its books and the UI to check in, check out, and reconcile. (3) The profile page.
- [ ] Users can add lending libraries.
- [ ] Users can "check in" and "check out" books in a library, or "reconcile" the quantity of a book in a library.
- [ ] User transactions will be associated with a "username", but any user can associate a transaction with any username. This username will form the backbone of an identity table for v2.
- [ ] Integration with Open Library for a cover image, title, and author.
- [ ] Users can search for libraries near a location, or their current location, and can view the profile of a library.
- [ ] The initial set of libraries is seeded from the Open Street Map contributors.

### v2

- [ ] Users can authenticate with Google. Session management strategy?
- [ ] Users can check in and out by scanning the barcode that encodes the ISBN with their camera.
- [ ] Little Library Index will contribute lending libraries back to Open Street Map.
- [ ] Users can upload an image of lending libraries.
- [ ] Server-side drafts of new libraries, so user progress is saved automatically. Independent of authentication.
- [ ] Deduplication of books without ISBNs, like zines.
- [ ] Localization strategy? ISO 639-2 language code for each book.
- [ ] Self host cover images for books without ISBN codes. Especially for things like zines.
- [ ] ISO 639.3 language support.
- [ ] Support libraries that aren't geometric points, like OSM ways.

### v3

- [ ] Users can acquire a code, or purchase a sticker with a barcode, that allows a book to be tracked through the lending library network. Maybe they can participate in a conversation with only folks who have encountered that particular book.
- [ ] Users gain points for being librarians. My friend suggested that maybe they can decorate the virtual representation of the lending libraries, e.g., with stickers. Or maybe, you unlock the ability to get notified if there's a particular book deposited.

## Housekeeping

- [ ] You need a linter
- [ ] You need a reproducible Postgres environment. Learn containerization

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
