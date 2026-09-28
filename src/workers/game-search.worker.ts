// Fuzzy search over Discord's whole game list (~25k games), off the UI
// thread: typing in Spotlight never waits for it.
import Fuse from 'fuse.js'

export interface SearchEntry {
    id: string;
    name: string;
    aliases: string[];
    /** executable names */
    exes: string[];
}

export type SearchRequest =
    | { type: 'load'; entries: SearchEntry[] }
    | { type: 'search'; seq: number; query: string; limit: number }

export type SearchResponse =
    | { type: 'ready' }
    | { type: 'results'; seq: number; ids: string[] }

const ctx = self as unknown as {
    postMessage(message: SearchResponse): void;
    onmessage: ((e: MessageEvent<SearchRequest>) => void) | null;
}

const ignoredSymbols = /[©™®]/g
let fuse: Fuse<SearchEntry> | null = null

ctx.onmessage = ({ data }) => {
    if (data.type === 'load') {
        fuse = new Fuse(data.entries, {
            // name first, then aliases, then executables
            keys: [
                { name: 'name', weight: 0.7 },
                { name: 'aliases', weight: 0.2 },
                { name: 'exes', weight: 0.1 },
            ],
            getFn: (obj, path) => {
                const value = Fuse.config.getFn(obj, path)
                return typeof value === 'string' ? value.replace(ignoredSymbols, '') : value
            },
            isCaseSensitive: false,
            threshold: 0.5,
        })
        ctx.postMessage({ type: 'ready' })
    } else if (data.type === 'search') {
        const ids = fuse ? fuse.search(data.query, { limit: data.limit }).map(r => r.item.id) : []
        ctx.postMessage({ type: 'results', seq: data.seq, ids })
    }
}
