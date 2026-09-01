# littlelibraryindex.com

An open source, free index of [lending libraries](https://en.wikipedia.org/wiki/Lending_library), maintained by its users. I'm interested in the kinds of giving economies described by Robin Wall Kimmerer in their book _The Serviceberry_, and my hope is that an accessible index will encourage more people to participate in lending libraries in our communities. If I can see that an interesting zine or novel was deposited at a library near me, for example, I'm more likely to interact with this awesome distributed library.

No affiliation with the 501(c)(3) nonprofit [Little Free Library](https://littlefreelibrary.org). The term _little library_ is used here as a colloqualism for the lending library.

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
- This project will never be vibe coded, but I use Anthropic's Sonnet 5 as a design partner. And sometimes I let it [write obscure SQL functions for me](https://github.com/jacksoncooper/little-library-index/commit/cf4164b8624de438d9eef8663dd23aee7f8bab82). I want to understand everything I write in this project, even if it's not the efficient way to go about it. And, [it feels more meaningful](https://journal.stuffwithstuff.com/2026/01/24/the-value-of-things) this way. This is something I care about existing in the world and for it to be built with care.
- To the extent possible, I want the read-only endpoints to work without JavaScript. This means a URL-parameter first design. Any JavaScript can manipulate the DOM according to those endpoints without a page refresh.

## Project notes

- **OpenStreetMap**: Lending libraries [have an `amenity` tag with the value `public_bookcase`](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dpublic_bookcase). We'd eventually like to contribute libraries registered with the application back to OpenStreetMap. For now, we can use this data source to populate useful information about lending libraries that users add, like `description` and `opening_hours`. Other cool amenities: `give_box` and `public_art_gallery`.

## Features

### v1: The minimal viable website
(that I can deploy and be excited about)

- [ ] The minimal scope for v1 is 4 pages: (1) the home page, with a map showing libraries near you or, failing location services, a default view. Below, a list of those same libraries. Clicking on any takes you to the page for that library. To the right, recent transactions in that bounding box. (2) The library page, displaying its books and the UI to check in, check out, and reconcile. (3) The profile page (4) a page with shortcuts to view the lending libraries around a particular city or other place.
- [ ] Users can add lending libraries.
- [ ] Users can "check in" and "check out" books in a library, or "reconcile" the quantity of a book in a library.
- [ ] User transactions will be associated with a "username", but any user can associate a transaction with any username. This username will form the backbone of an identity table for v2.
- [ ] Integration with Open Library for a cover image, title, and author.
- [ ] Users can pan a map to retrieve libraries in that location. The map will cluster dense pins. This bounding box will inform both the list of libraries displayed below the map and the recent transactions visible to the right of both map and library list. This map will start centered on the continental United States. With location services, it can fly to the user's current location.
- [ ] The list of libraries is paginated. Panning the map will update a URL parameter with a bounding box, and update the library list to be equivalent to what you would see during a page refresh.
- [ ] The initial set of libraries is seeded from the Open Street Map contributors.
- [ ] A hard-coded page of cities to give non-JS users a path to view libraries at their location. Each entry in this page is an anchor to a friendly URL like `?city=chicago`. My server will translate that to an HTTP redirect to the home page with a reasonable bounding box. It would be awesome for these URLs to be user-contributed in the web application, but for now, GitHub will suffice.
- [ ] Users can mark a library as retired, which will remove it from the home page, but it will still be accessible by its permanent URL code.

### v1.5: The minimum website for actual people

- [ ] Users can authenticate themselves with OpenStreetMap. Session management?
- [ ] Operations on a library's metadata must be authenticated, because they're going back to Open Street Map, eventually, and to prevent vandalism. This provides an opportunity to add additional library metadata that OSM can benefit from. `name` and `description` are already there, and `location` for `node`s. `brand` is not yet.
- [ ] Users can view the edit history of a library's metadata and its inventory. And restore the library's metadata to prior version. Its inventory can be reconciled at any point.
- [ ] Users can enter repairs required for a library.
- [ ] Users can check in and out by scanning the barcode that encodes the ISBN with their camera.
- [ ] Deduplication of books without ISBNs, like zines. At the very least book search.
- [ ] JavaScript-enabled interaction for a nicer UI.

### v2: A good open-source member

- [ ] Little Library Index will contribute lending libraries back to Open Street Map.
- [ ] Self host cover images for books without ISBN codes. Especially for things like zines.
- [ ] Support searching for libraries by naming a location, and get a reasonable bounding box for that location, with a drop-down to resolve ambiguous locations, e.g., San Francisco, CA versus San Francisco, Agusan del Sur. v1 has an inflexible hard-coded dropdown with pretty URL parameter names. This is the generalization of that feature.

### In the future

- [ ] Users can upload an image of lending libraries.
- [ ] Server-side drafts of new libraries, so user progress is saved automatically. Independent of authentication.
- [ ] Localization strategy? ISO 639-2 language code for each book.
- [ ] ISO 639.3 language support.
- [ ] Support libraries that aren't geometric points, like OSM ways.

### Long term features

- [ ] Users can acquire a code, or purchase a sticker with a barcode, that allows a book to be tracked through the lending library network. Maybe they can participate in a conversation with only folks who have encountered that particular book.
- [ ] Users gain points for being librarians. My friend suggested that maybe they can decorate the virtual representation of the lending libraries, e.g., with stickers. Or maybe, you unlock the ability to get notified if there's a particular book deposited.

## Housekeeping

- [x] A linter
- [ ] A reproducible Postgres environment. Learn containerization

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
