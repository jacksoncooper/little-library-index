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
  -- The time the web server receives the request to create the library. I can
  -- display something nifty and hip with this value, like "est. April 2026".
  -- This isn't the time at which the library was physically constructed.
  created_at           timestamp with time zone NOT NULL,
  created_by           integer REFERENCES users (id) NOT NULL,
  -- For v1, we're tracking the handle and time of the last modification to
  -- the database. In the future for v2, I'd like a full edit history of
  -- libraries to restore vandalism.
  version              integer NOT NULL DEFAULT 1,
  last_edited_at       timestamp with time zone,
  last_edited_by       integer REFERENCES users (id),
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
  -- For v1, we're tracking the handle and time of the last modification to
  -- the database. In the future for v2, I'd like a full edit history of books
  -- to restore vandalism.
  version              integer NOT NULL DEFAULT 1,
  last_edited_at       timestamp with time zone,
  last_edited_by       integer REFERENCES users (id),
  title           text NOT NULL,
  author          text,
  -- Open Library languages are from MARC.
  --
  --   https://openlibrary.org/languages.json
  --   https://www.loc.gov/marc/languages/language_code.html
  --
  -- We want ISO 639.2 with the goal of moving to ISO 639.3. ISO 639.2 gives
  -- more than one code for 21 languages for bibliographic ("B") and terminology
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


CREATE DOMAIN isbn_13
  AS text
  -- We don't use `AND is_valid_isbn_13` here, because SQL doesn't guarantee
  -- short-circuit evaluation of Boolean operators. This becomes a column
  -- constraint instead.
  --
  --   https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-EXPRESS-EVAL
  --
  CHECK (VALUE ~ '^[0-9]{13}$');

CREATE FUNCTION is_valid_isbn_13(isbn isbn_13) RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  BEGIN ATOMIC
  -- Sonnet 5 wrote the body of this function because I don't know SQL, so
  -- let's break it down.
  --
  -- Given this beautiful book ISBN 978-1-63973-448-1, the `isbn` parameter is
  -- the string '9781639734481'.
  --
  -- # SELECT unnest(ARRAY ['9', '7', '8', ..., '1']) as digit;
  --    digit
  --   -------
  --    9
  --    7
  --    8
  --    ...
  --    1
  -- (13 rows)
  --
  -- `WITH ORDINALITY` adds a `bigint` index column to the rows of the function
  -- it's applied to.
  --
  -- # SELECT * FROM unnest(ARRAY ['9', '7', '8', ..., '1']) WITH ORDINALITY _(digit, i);
  --  digit | i
  -- -------+----
  --  9     |  1
  --  7     |  2
  --  8     |  3
  --  ...
  --  1     | 13
  -- (13 rows)
  --
  -- The algorithm itself for verifying the checksum digit is some interesting
  -- modular arithmetic, equivalent to the ISBN-13 standard text.
  --
  -- TODO: A fun exercise for me later is to prove it.
  --
  --   https://en.wikipedia.org/wiki/ISBN#ISBN-13_check_digit_calculation
  --
    SELECT SUM(digit::int * CASE WHEN i % 2 = 1 THEN 1 ELSE 3 END) % 10 = 0
    FROM unnest(string_to_array(isbn, NULL)) WITH ORDINALITY _(digit, i);
  END;

CREATE TABLE isbns (
  id            serial PRIMARY KEY,
  isbn_13       isbn_13 UNIQUE NOT NULL CHECK (is_valid_isbn_13(isbn_13)),
  -- In what version was the ISBN written on the back cover of the book? All
  -- 10-digit ISBNs can be converted to 13-digit ISBNs.
  source_format isbn_version NOT NULL,
  book_id       integer REFERENCES books (id) NOT NULL
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

CREATE INDEX libraries_by_location ON libraries USING GIST (
  (location::geometry)
);

-- Because this index is built on a two-tuple, it allows us to efficiently
-- select all inventory events for a given library, and not just for a given
-- library and book pair. This works because the library comes first in the
-- two-tuple, and comparisons between these tuples are broken first by the
-- libraries being compared.
CREATE INDEX inventory_events_by_library_id_and_book_id
  ON inventory_events (library_id, book_id);
