CREATE EXTENSION postgis;

-- Users! --

CREATE DOMAIN handle
  AS character varying(32)
  CHECK (
    VALUE ~ '^[\w.]+$'
    AND VALUE IS NFC NORMALIZED
  );

CREATE TABLE users (
  id serial PRIMARY KEY,
  handle handle UNIQUE NOT NULL
);

-- Libraries! --

CREATE TYPE osm_element_type
  AS ENUM (
    'node',
    'way',
    'relation'
);

-- A non-enumerable Base36 encoded library identifier for use in URLs like
-- https://littlelibraryindex.com/library/ae7n1d. This gives us 36^6 or
-- over 2 billion libaries.
CREATE DOMAIN url_id
  AS char(6)
  CHECK (VALUE ~ '^[a-z0-9]+$');

CREATE TABLE osm_element_ids (
  id           serial PRIMARY KEY,
  element_type osm_element_type NOT NULL,
  element_id   bigint NOT NULL,
  -- From https://wiki.openstreetmap.org/wiki/Elements#Ids,
  --   "Element types have their own ID space, so there could be a node with
  --   id=100 and a way with id=100, which are unlikely to be related or
  --   geographically near to each other."
  UNIQUE (element_type, element_id)
);

CREATE TABLE libraries (
  id                   serial PRIMARY KEY,
  created_at           timestamp with time zone NOT NULL,
  created_by           integer REFERENCES users (id) NOT NULL,
  url_id               url_id UNIQUE NOT NULL,
  location             geography(Point, 4326) NOT NULL,
  title                text,
  description          text,
  osm_element_id       integer REFERENCES osm_element_ids (id)
);

-- Books! --

CREATE TABLE open_library_ids (
  id         serial PRIMARY KEY,
  work_id    text NOT NULL,
  edition_id text UNIQUE NOT NULL,
  author_id  text
);

CREATE TABLE books (
  id              serial PRIMARY KEY,
  url_id          url_id UNIQUE NOT NULL,
  created_at      timestamp with time zone NOT NULL,
  created_by      integer REFERENCES users (id) NOT NULL,
  title           text NOT NULL,
  author          text,
  -- Open Library languages are from MARC.
  --
  --   https://openlibrary.org/languages.json
  --   https://www.loc.gov/marc/languages/language_code.html
  --
  -- We want ISO 639.2 with the goal of moving to ISO 639.3. ISO 639.2 gives more
  -- than one code for 21 languages for bibliographic ("B") and terminology
  -- ("T") purposes. Fortunately for us, all MARC language codes are "B" ISO
  -- 639.2 codes.
  --
  --  https://www.loc.gov/standards/iso639-2/php/code_list.php
  --
  iso_639_2       text,
  publisher       text,
  publish_date    text,
  description     text,
  open_library_id integer REFERENCES open_library_ids (id)
);

CREATE TYPE isbn_version
  AS ENUM (
    'isbn_10',
    'isbn_13'
);

CREATE TABLE isbns (
  id      serial PRIMARY KEY,
  -- TODO: Should this be an unconstrained string? I need to understand how the
  -- ISBN format works.
  isbn    text UNIQUE NOT NULL,
  version isbn_version NOT NULL
);

CREATE TABLE isbn_to_book (
  isbn_id integer PRIMARY KEY REFERENCES isbns (id),
  book_id integer REFERENCES books (id) NOT NULL
);

-- Transactions! --

CREATE TYPE inventory_event_type
  AS ENUM (
    'check_in',
    'check_out',
    'reconcile'
  );

CREATE TABLE inventory_events (
  id             serial PRIMARY KEY,
  entered_at     timestamp with time zone NOT NULL,
  entered_by     integer REFERENCES users (id) NOT NULL,
  type           inventory_event_type NOT NULL,
  library_id     integer REFERENCES libraries (id) NOT NULL,
  book_id        integer REFERENCES books (id) NOT NULL,
  delta          integer NOT NULL,
  -- Whether the user wants the transaction to be visible in the live feed.
  visible        boolean NOT NULL default true,
  -- Whether the user wants their handle to be visible in the transaction.
  handle_visible boolean NOT NULL default false
);

-- Because this index is built on a two-tuple, it allows us to efficiently
-- select all inventory events for a given library, and not just for a given
-- library and book pair. This works because the library comes first in the
-- two-tuple, and comparisons between these tuples are broken first by the
-- libraries being compared.
CREATE INDEX inventory_events_by_library_id_and_book_id
  ON inventory_events (library_id, book_id);
