CREATE EXTENSION postgis;

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
  element_id   bigint NOT NULL,
  element_type osm_element_type NOT NULL
);

CREATE TABLE libraries (
  id                   serial PRIMARY KEY,
  url_id               url_id UNIQUE NOT NULL,
  osm_element_id       integer REFERENCES osm_element_ids (id),
  created_at           timestamp with time zone NOT NULL,
  location             geography(Point, 4326) NOT NULL,
  title                text,
  description          text,
  accessibility_notes  text
);

-- Books! --

CREATE TABLE open_library_ids (
  id         serial PRIMARY KEY,
  work_id    text UNIQUE NOT NULL,
  edition_id text UNIQUE NOT NULL,
  author_id  text UNIQUE
);

CREATE TABLE books (
  id              serial PRIMARY KEY,
  url_id          url_id UNIQUE NOT NULL,
  created_at      timestamp with time zone NOT NULL,
  title           text NOT NULL,
  author          text,
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
  isbn    text UNIQUE NOT NULL,
  version isbn_version NOT NULL
);

CREATE TABLE isbn_to_book (
  isbn_id integer PRIMARY KEY REFERENCES isbns (id),
  book_id integer REFERENCES books (id) NOT NULL
);
