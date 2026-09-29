// Which games a search "contains", for picking random games from it. The
// fuzzy search that ranks Spotlight's results also accepts weak matches (fine
// for the top few, not for "random games like this"), so random picks use
// plain keyword matching: every word you typed must appear in the game's name
// or one of its other names. A single letter picks from games that have it.

const ignoredSymbols = /[©™®]/g

export function normalize(text: string) {
    return text.replace(ignoredSymbols, '').toLowerCase()
}

/** The words of a search, normalized; empty for a blank search. */
export function keywords(query: string) {
    return normalize(query).split(/\s+/).filter(Boolean)
}

/** Every keyword appears in the name or in one of the aliases. */
export function matchesKeywords(name: string, aliases: readonly string[], words: readonly string[]) {
    const texts = [normalize(name), ...aliases.map(normalize)]
    return words.every(word => texts.some(text => text.includes(word)))
}

/** Fuzzy matches this close still count when no name contains the words (a typo). */
export const CLOSE_MATCH_SCORE = 0.3
