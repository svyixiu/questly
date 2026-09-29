import { createGlobalState } from '@vueuse/core'
import { computed, ref, toRaw, watch } from 'vue'
import Fuse from 'fuse.js'
import type { Game } from '@/types/types'
import type { SearchEntry, SearchRequest, SearchResponse } from '@/workers/game-search.worker'
import { CLOSE_MATCH_SCORE, keywords, matchesKeywords } from '@/utils/keyword-match'
import { useGameDB } from './game-db'

/**
 * Searches Discord's game list in a background worker. The worker gets a
 * slimmed-down copy of the list once, when the app is idle after loading;
 * each search then only sends back the matching ids.
 */
export const useGameSearch = createGlobalState(() => {
    const { gameDB } = useGameDB()
    // keeps the reactive versions, which are what the rest of the app works with
    const byId = computed(() => new Map(gameDB.value.map(g => [String(g.id), g])))
    /** the index is built, so searches answer right away */
    const ready = ref(false)

    let worker: Worker | null = null
    try {
        worker = new Worker(new URL('../workers/game-search.worker.ts', import.meta.url), { type: 'module' })
    } catch {
        worker = null
    }

    let seq = 0
    /** the one search in flight: only the latest matters */
    let inFlight: { seq: number; resolve: (games: Game[]) => void } | null = null
    /** a search made before the index was ready */
    let queued: (() => void) | null = null
    /** searchAll() requests: each gets its answer, whatever is being typed meanwhile */
    const allPending = new Map<number, (games: Game[]) => void>()
    /** searchAll() requests made before the index was ready */
    let waiting: (() => void)[] = []

    function settle(games: Game[]) {
        inFlight?.resolve(games)
        inFlight = null
    }

    function whenReady() {
        ready.value = true
        queued?.()
        queued = null
        waiting.forEach(run => run())
        waiting = []
    }

    if (worker) {
        worker.onmessage = ({ data }: MessageEvent<SearchResponse>) => {
            if (data.type === 'ready') {
                whenReady()
                return
            }
            const games = () => data.ids.map(i => byId.value.get(i)).filter((g): g is Game => !!g)
            if (inFlight && data.seq === inFlight.seq) {
                settle(games())
            } else if (allPending.has(data.seq)) {
                const resolve = allPending.get(data.seq)!
                allPending.delete(data.seq)
                resolve(games())
            }
        }
        worker.onerror = () => { worker = null; whenReady() }
    }

    const send = (message: SearchRequest) => worker?.postMessage(message)

    // no worker (shouldn't happen in the app): search on this thread instead
    let fallback: Fuse<Game> | null = null
    function fallbackIndex() {
        fallback ??= new Fuse(gameDB.value, {
            keys: [{ name: 'name', weight: 0.7 }, { name: 'aliases', weight: 0.2 }, { name: 'executables.name', weight: 0.1 }],
            includeScore: true,
            threshold: 0.5,
        })
        return fallback
    }

    function searchHere(q: string, limit: number) {
        return fallbackIndex().search(q, { limit }).map(r => r.item)
    }

    /** matchAll on this thread (same rules as the worker) */
    function matchAllHere(q: string) {
        const words = keywords(q)
        const found = gameDB.value.filter(g => matchesKeywords(String(g.name), (g.aliases ?? []).map(String), words))
        if (found.length > 0) return found
        return fallbackIndex().search(q).filter(r => (r.score ?? 1) <= CLOSE_MATCH_SCORE).map(r => r.item)
    }

    // hand the list over when the app is idle, so it never competes with the UI
    watch(gameDB, list => {
        fallback = null
        if (list.length === 0 || !worker) return
        ready.value = false
        // plain copies: reactive proxies can't be sent to a worker (and are slow to walk)
        const load = () => {
            try {
                send({
                    type: 'load',
                    entries: toRaw(list).map((g): SearchEntry => ({
                        id: String(g.id),
                        name: String(g.name),
                        aliases: (g.aliases ?? []).map(String),
                        exes: (g.executables ?? []).map(e => String(e.name)),
                    })),
                })
            } catch {
                // search on this thread instead of waiting forever
                worker = null
                ready.value = true
                queued?.()
                queued = null
            }
        }
        if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 2000 })
        else setTimeout(load, 200)
    }, { immediate: true })

    /** Best matches first. A newer search makes older ones resolve with []. */
    function search(query: string, limit = 40): Promise<Game[]> {
        const q = query.trim()
        settle([])
        if (queued) queued = null
        if (!q) return Promise.resolve([])
        if (!worker) return Promise.resolve(searchHere(q, limit))
        const id = ++seq
        return new Promise(resolve => {
            inFlight = { seq: id, resolve }
            const run = () => {
                if (!worker) return settle(searchHere(q, limit))
                send({ type: 'search', seq: id, query: q, limit })
            }
            if (ready.value) run()
            else queued = run
        })
    }

    /**
     * Every game the search contains (the whole list when it's empty), for a
     * random pick: each word typed appears in the name or another name, or, if
     * no game has them, the close fuzzy matches (utils/keyword-match.ts).
     * Doesn't disturb the search being typed.
     */
    function searchAll(query: string): Promise<Game[]> {
        const q = query.trim()
        if (!q) return Promise.resolve(gameDB.value)
        if (!worker) return Promise.resolve(matchAllHere(q))
        const id = ++seq
        return new Promise(resolve => {
            allPending.set(id, resolve)
            const run = () => {
                if (worker) return send({ type: 'matchAll', seq: id, query: q })
                allPending.delete(id)
                resolve(matchAllHere(q))
            }
            if (ready.value) run()
            else waiting.push(run)
        })
    }

    return { search, searchAll, ready }
})
