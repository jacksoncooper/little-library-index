-- Run with `psql little-library-index -f library_table.sql`.

-- 🫳 Dropping for fun and profit, for debugging! 🫳 --
DROP TABLE IF EXISTS libraries;
DROP TABLE IF EXISTS osm_element_ids;

DROP DOMAIN IF EXISTS url_id;
DROP TYPE IF EXISTS osm_element_type;

DROP EXTENSION IF EXISTS postgis;
-- 🫳 ✨ 🫳 --

CREATE EXTENSION postgis;
 
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
