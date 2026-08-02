#!/usr/bin/env bash
dropdb little-library-index
createdb --locale-provider=icu --icu-locale=und --template=template0 little-library-index
psql little-library-index -f database/schema.sql
