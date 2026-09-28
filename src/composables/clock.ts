import { createGlobalState, useNow } from '@vueuse/core'

/**
 * One shared twice-a-second clock for live timers. Only what actually reads
 * it re-renders on each tick (e.g. library rows with a running game), so an
 * idle list of hundreds of games stays still.
 */
export const useClock = createGlobalState(() => useNow({ interval: 500 }))
