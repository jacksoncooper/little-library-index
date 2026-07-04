-- Run with `psql little-library-index -f library_table.sql`.

-- 🫳 Dropping for fun and profit, for debugging! 🫳 --
DROP TABLE IF EXISTS libraries;

DROP TYPE IF EXISTS osm_element_type;
DROP DOMAIN IF EXISTS url_id;

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
 
CREATE TABLE libraries (
  id                   serial PRIMARY KEY,
  url_id               url_id UNIQUE NOT NULL,
  osm_id               bigint,
  osm_type             osm_element_type,
  created_at           timestamp with time zone NOT NULL,
  location             geography(Point, 4326) NOT NULL,
  title                text,
  description          text,
  accessibility_notes  text,
 
  CONSTRAINT both_osm_ids
    CHECK ((osm_id IS NOT NULL) AND (osm_type IS NOT NULL))
);
