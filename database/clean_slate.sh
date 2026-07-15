#!/usr/bin/env bash
dropdb little-library-index
createdb little-library-index
psql little-library-index -f database/schema.sql
