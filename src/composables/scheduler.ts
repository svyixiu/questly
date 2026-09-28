import { createGlobalState } from '@vueuse/core'
import { computed, ref } from 'vue'
import type { Game } from '@/types/types'
import { defaultExecutable, formatDuration, isGameRunning, runningExecutable } from '@/utils/executables'
import { useGameLibrary } from './game-library'
import { useGlobalState } from './app-state'
import { useToasts } from './toasts'
import { showWindow, useSettings } from './settings'
import { useDiscordDetect } from './discord-detect'
import { usePerformanceGuard } from './performance-guard'

export type TimerMode = 'parallel' | 'sequential'
export type TimerOrder = 'fixed' | 'random'
export type RunItemState = 'queued' | 'launching' | 'waiting' | 'running' | 'done' | 'failed'
/** how a game's turn ended */
type RunResult = 'time' | 'stopped' | 'shed' | 'failed' | 'cancelled'

export interface RunItem {
    uid: string;
    state: RunItemState;
    /** when this game's countdown ends (state 'running') */
    endsAt?: number;
    /** since when we've been waiting for Discord (state 'waiting') */
    waitingSince?: number;
    /** how the countdown got started */
    trigger?: 'discord' | 'timeout' | 'manual' | 'immediate';
    /** set by "Start now" while waiting for Discord */
    forceStart?: boolean;
    /** when it was (last) launched */
    launchedAt?: number;
    /** countdown left when Performance Guard paused it */
    remainingMs?: number;
    /** Performance Guard asked for this game to be closed for now */
    shed?: boolean;
    /** closed by Performance Guard; resumes when the PC calms down */
    pausedByGuard?: boolean;
}

export interface TimedRun {
    mode: TimerMode;
    order: TimerOrder;
    durationMs: number;
    waitForDiscord: boolean;
    items: RunItem[];
    startedAt: number;
}

export interface StartOptions {
    mode: TimerMode;
    order: TimerOrder;
    waitForDiscord: boolean;
}

export function shuffle<T>(list: T[]): T[] {
    const a = [...list]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

export const useScheduler = createGlobalState(() => {
    const library = useGameLibrary()
    const discord = useDiscordDetect()
    const { addLog } = useGlobalState()
    const { toast } = useToasts()
    const { settings } = useSettings()
    const guard = usePerformanceGuard()

    const run = ref<TimedRun | null>(null)
    // bumped on start/cancel so a superseded run's async work stops
    let token = 0

    const isActive = computed(() => run.value !== null)

    /** 0..1 across the whole run */
    function progress(now: number) {
        const r = run.value
        if (!r || r.items.length === 0) return 0
        let sum = 0
        for (const item of r.items) {
            if (item.state === 'done' || item.state === 'failed') sum += 1
            else if (item.state === 'running' && item.endsAt) sum += 1 - Math.max(0, item.endsAt - now) / r.durationMs
            else if (item.remainingMs !== undefined) sum += 1 - item.remainingMs / r.durationMs
        }
        return sum / r.items.length
    }

    /**
     * Polls until `done()` returns a result. Timestamps are compared (not tick
     * counts), so throttled timers in a hidden window only delay the check.
     */
    function poll<T>(myToken: number, done: () => T | undefined): Promise<T | 'cancelled'> {
        return new Promise(resolve => {
            const check = () => {
                if (myToken !== token) return resolve('cancelled')
                const result = done()
                if (result !== undefined) return resolve(result)
                setTimeout(check, 400)
            }
            check()
        })
    }

    let hidOnce = false
    async function runItem(item: RunItem, r: TimedRun, myToken: number): Promise<RunResult> {
        const game = library.findByUid(item.uid)
        if (!game) { item.state = 'failed'; return 'failed' }

        item.shed = false
        item.pausedByGuard = false
        item.forceStart = false
        item.state = 'launching'
        item.launchedAt = Date.now()
        const wasRunning = isGameRunning(game)
        const ok = wasRunning || await library.launch(game, undefined, { quiet: true })
        if (myToken !== token) return 'cancelled'
        if (!ok) {
            item.state = 'failed'
            toast('error', `Skipped ${game.name}`, "It couldn't be launched. See the activity log.")
            return 'failed'
        }
        if (!hidOnce) { hidOnce = true; library.maybeAutoHide() }

        // Wait until Discord says it sees the game, so the countdown matches quest progress
        const exe = runningExecutable(game)
        if (r.waitForDiscord && discord.available.value && !wasRunning && !exe?.detected_at) {
            item.state = 'waiting'
            item.waitingSince = Date.now()
            const timeoutMs = Math.max(10, settings.value.detectTimeoutSec) * 1000
            const result = await poll(myToken, () => {
                if (item.shed) return 'shed' as const
                const current = runningExecutable(game)
                if (!current) return 'stopped' as const
                if (current.detected_at) return 'discord' as const
                if (item.forceStart) return 'manual' as const
                if (Date.now() - item.waitingSince! > timeoutMs) return 'timeout' as const
                return undefined
            })
            if (result === 'cancelled') return 'cancelled'
            if (result === 'shed') return pause(item, game.uid!)
            if (result === 'stopped') { item.state = 'done'; return 'stopped' }
            item.trigger = result
            if (result === 'timeout') {
                addLog('warning', `Discord didn't report ${game.name} within ${settings.value.detectTimeoutSec}s; countdown started anyway`)
                toast('warning', `Discord didn't report ${game.name}`, `Started the countdown anyway after ${settings.value.detectTimeoutSec} seconds.`)
            }
        } else {
            item.trigger = exe?.detected_at ? 'discord' : 'immediate'
        }

        item.state = 'running'
        // resumed after Performance Guard paused it: only the time that was left
        item.endsAt = Date.now() + (item.remainingMs ?? r.durationMs)
        item.remainingMs = undefined
        // stopping the game by hand ends its turn early
        const end = await poll(myToken, () =>
            item.shed ? 'shed' as const
                : !isGameRunning(game) ? 'stopped' as const
                    : Date.now() >= item.endsAt! ? 'time' as const : undefined
        )
        if (end === 'cancelled') return 'cancelled'
        if (end === 'shed') {
            item.remainingMs = Math.max(1000, item.endsAt! - Date.now())
            return pause(item, game.uid!)
        }
        if (isGameRunning(game)) await library.stop(game, undefined, { quiet: true })
        item.state = 'done'
        return end
    }

    /** Performance Guard: close the game for now; it goes back in the queue. */
    async function pause(item: RunItem, uid: string): Promise<RunResult> {
        const game = library.findByUid(uid)
        if (game && isGameRunning(game)) await library.stop(game, undefined, { quiet: true })
        item.state = 'queued'
        item.endsAt = undefined
        item.waitingSince = undefined
        item.shed = false
        item.pausedByGuard = true
        addLog('info', `Performance Guard paused ${game?.name ?? 'a game'}; it resumes when the PC calms down`)
        return 'shed'
    }

    /**
     * "All at once", as a pool: without a limit every game starts right away
     * (a little apart while Performance Guard watches, so a struggling PC is
     * noticed early). When the guard lowers its limit, the game with the most
     * time left is paused and put back in the queue.
     */
    async function runParallel(r: TimedRun, myToken: number) {
        const queue = [...r.items]
        const inFlight = new Map<RunItem, Promise<void>>()
        let played = 0
        let lastLaunch = 0
        let wake = () => {}
        // total: the games still to play (finished ones no longer need room)
        guard.begin(() => inFlight.size, () => inFlight.size + queue.length)
        try {
            while (myToken === token && (queue.length > 0 || inFlight.size > 0)) {
                const cap = guard.enabled.value && guard.limit.value !== null ? guard.limit.value : Infinity
                const active = [...inFlight.keys()].filter(i => !i.shed)
                if (active.length > cap) {
                    const now = Date.now()
                    const left = (i: RunItem) => i.state === 'running' && i.endsAt ? i.endsAt - now : i.remainingMs ?? r.durationMs
                    active.sort((a, b) => left(b) - left(a) || (b.launchedAt ?? 0) - (a.launchedAt ?? 0))[0].shed = true
                }
                while (queue.length > 0 && inFlight.size < cap && myToken === token) {
                    if (guard.enabled.value && Date.now() - lastLaunch < 700) break
                    const item = queue.shift()!
                    lastLaunch = Date.now()
                    inFlight.set(item, runItem(item, r, myToken).then(result => {
                        inFlight.delete(item)
                        if (result === 'shed') queue.unshift(item)
                        else if (result === 'time') played++
                        wake()
                    }))
                }
                await new Promise<void>(resolve => { wake = resolve; setTimeout(resolve, 350) })
            }
        } finally {
            guard.end()
        }
        return played
    }

    async function start(games: Game[], seconds: number, options: StartOptions) {
        if (run.value) return
        const targets = games.filter(g => defaultExecutable(g))
        if (targets.length === 0) {
            toast('error', 'Nothing to run', 'None of these games have a launchable executable.')
            return
        }
        const mode: TimerMode = targets.length > 1 ? options.mode : 'parallel'
        const myToken = ++token
        hidOnce = false
        settings.value.timerSeconds = seconds
        settings.value.timerWaitForDiscord = options.waitForDiscord
        if (targets.length > 1) {
            settings.value.timerMode = options.mode
            settings.value.timerOrder = options.order
        }

        run.value = {
            mode,
            order: options.order,
            durationMs: Math.max(1000, Math.round(seconds * 1000)),
            waitForDiscord: options.waitForDiscord,
            items: targets.map(g => ({ uid: g.uid!, state: 'queued' as const })),
            startedAt: Date.now(),
        }
        const r = run.value
        addLog('info', `Timed run started: ${targets.length} game(s), ${formatDuration(seconds)} each, ${mode}${mode === 'sequential' ? ` (${options.order} order)` : ''}${options.waitForDiscord ? ', waiting for Discord' : ''}`)

        try {
            let played = 0
            if (mode === 'parallel') {
                played = await runParallel(r, myToken)
            } else {
                for (const item of r.items) {
                    if (myToken !== token) break
                    if (await runItem(item, r, myToken) === 'time') played++
                }
            }
            if (myToken !== token) return
            addLog('info', `Timed run finished (${played} game(s) played the full time)`)
            toast('success', 'Timed run finished', `${played} game${played === 1 ? '' : 's'} played for ${formatDuration(seconds)}${mode === 'sequential' ? ' each' : ''}.`, 6000)
            if (settings.value.showOnTimerEnd) showWindow()
        } finally {
            if (myToken === token) run.value = null
        }
    }

    /** Skip waiting for Discord and start this game's countdown right away. */
    function startNow(uid: string) {
        const item = run.value?.items.find(i => i.uid === uid)
        if (item?.state === 'waiting') item.forceStart = true
    }

    async function cancel({ stopGames = true, quiet = false } = {}) {
        const r = run.value
        if (!r) return
        token++
        run.value = null
        if (stopGames) {
            for (const item of r.items) {
                const game = library.findByUid(item.uid)
                if (game && isGameRunning(game)) await library.stop(game, undefined, { quiet: true })
            }
        }
        addLog('info', 'Timed run cancelled')
        if (!quiet) toast('info', 'Timed run cancelled')
    }

    function statusFor(uid: string): (RunItem & { position: number }) | null {
        const r = run.value
        if (!r) return null
        const index = r.items.findIndex(i => i.uid === uid)
        if (index < 0) return null
        // position among games still waiting their turn (sequential)
        const firstPending = r.items.findIndex(i => i.state === 'queued')
        const position = r.items[index].state === 'queued' && firstPending >= 0 ? index - firstPending + 1 : 0
        return { ...r.items[index], position }
    }

    return { run, isActive, start, cancel, startNow, statusFor, progress }
})
