import { SQL } from 'bun';
import { WithPrimaryKey } from './types';

type OsmElementType = 'node' | 'relation' | 'way';

type OsmElementId = {
    elementType: OsmElementType,
    elementId: bigint,
};

type Location = {
    latitude: number,
    longitude: number
};

export type Library = {
    createdAt: Date,
    createdBy: number,
    urlId: string,
    location: Location,
    title: string | null,
    description: string | null,
    accessibilityNotes: string | null,
    osmElementId: number | null,
};

export async function writeOsmElementId(
    osmElementId: OsmElementId
): Promise<number> {
    return Promise.resolve(21);
}

export async function readOsmElementId(
    connection: SQL,
    id: number,
): Promise<WithPrimaryKey<OsmElementId> | null> {
    return Promise.resolve(null);
}

export async function writeLibrary(
    connection: SQL,
    library: Library
): Promise<number> {
    return Promise.resolve(42);
}

// Used to handle a request for a library. For example,
//
//   https://littlelibraryindex.com/library/o5c93c
//
export async function readLibraryByUrlId(
    connection: SQL,
    urlId: string
) : Promise<WithPrimaryKey<Library> | null> {
    return Promise.resolve(null);
}
