import { createGlobalState, useStorage } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Game } from '@/types/types'
import { defaultExecutable, isGameRunning, runningExecutable } from '@/utils/executables'
import { useSettings, type BuddySettings } from './settings'
import { useGameLibrary } from './game-library'
import { useGlobalState } from './app-state'
import { useDiscordDetect } from './discord-detect'
import { useScheduler } from './scheduler'
import { useStartup } from './startup'

export interface DiscordClient {
    id: string;
    name: string;
    installed: boolean;
    running: boolean;
}

export type BuddyPhase =
    | 'off'
    | 'blocked'
    | 'outside-hours'
    | 'waiting-idle'
    | 'waiting-discord'
    | 'starting-discord'
    | 'playing'
    | 'done-today'

interface BuddyGame {
    uid: string;
    name: string;
    /** how long it stays open once its time starts counting */
    minutes: number;
    launchedAt: number;
    /** when it closes (set once Discord detected it, or right away) */
    endsAt?: number;
    done?: boolean;
}

interface Session {
    startedAt: number;
    games: BuddyGame[];
    /** the Discord client Buddy started, to close it afterwards */
    openedDiscord: string | null;
    /** games start a little apart, like a person would */
    nextLaunchAt: number;
}

const TICK_MS = 20_000
/** input this recent means you're back at the PC */
const BACK_SECONDS = 45

function dayKey(d = new Date()) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function randInt(a: number, b: number) {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    return lo + Math.floor(Math.random() * (hi - lo + 1))
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Whether Buddy may play right now (hours can wrap past midnight, e.g. 22 → 3). */
export function inAllowedHours(b: BuddySettings, d = new Date()) {
    if (!b.days.includes(d.getDay())) return false
    if (b.fromHour === b.toHour) return true
    const h = d.getHours() + d.getMinutes() / 60
    return b.fromHour < b.toHour ? h >= b.fromHour && h < b.toHour : h >= b.fromHour || h < b.toHour
}

/**
 * Legitimate Buddy: while you're away from the PC it opens a few games from
 * your library, like you'd play them yourself, within the limits you set
 * (how long you've been idle, games per day, how long each, how many at
 * once, which hours and days, Discord running). It stops as soon as you're back.
 */
export const useBuddy = createGlobalState(() => {
    const { settings } = useSettings()
    const library = useGameLibrary()
    const scheduler = useScheduler()
    const discord = useDiscordDetect()
    const startup = useStartup()
    const { addLog } = useGlobalState()

    const b = computed(() => settings.value.buddy)
    const today = useStorage('questly.buddy.today', { day: '', target: 0, played: 0, playedIds: [] as string[] })
    const session = ref<Session | null>(null)
    const phase = ref<BuddyPhase>('off')
    const detail = ref('')
    const idleSeconds = ref(0)
    const lastRun = ref<{ at: number; games: string[]; reason: string } | null>(null)

    function setPhase(p: BuddyPhase, text = '') {
        phase.value = p
        detail.value = text
    }

    function log(message: string, type: 'info' | 'warning' = 'info') {
        addLog(type, `Legitimate Buddy: ${message}`)
    }

    /** a new day: pick how many games to play today */
    function rollDay() {
        const key = dayKey()
        if (today.value.day === key) return
        today.value = { day: key, target: randInt(b.value.gamesPerDayMin, b.value.gamesPerDayMax), played: 0, playedIds: [] }
    }

    // changed the games-per-day range: re-pick today's target within it
    watch(() => [b.value.gamesPerDayMin, b.value.gamesPerDayMax], () => {
        if (today.value.day !== dayKey()) return
        const lo = Math.min(b.value.gamesPerDayMin, b.value.gamesPerDayMax)
        const hi = Math.max(b.value.gamesPerDayMin, b.value.gamesPerDayMax)
        if (today.value.target < lo || today.value.target > hi) today.value.target = randInt(lo, hi)
    })

    /** Makes sure Discord is running, if the settings ask for it. */
    async function ensureDiscord(): Promise<{ ok: boolean; opened: string | null }> {
        const cfg = b.value
        if (!cfg.requireDiscord && !cfg.openDiscord) return { ok: true, opened: null }
        const clients = await invoke<DiscordClient[]>('discord_status').catch(() => [] as DiscordClient[])
        if (clients.some(c => c.running)) return { ok: true, opened: null }
        if (cfg.openDiscord) {
            const target = clients.find(c => c.installed && c.id === 'discord') ?? clients.find(c => c.installed)
            if (target) {
                setPhase('starting-discord', `Opening ${target.name}…`)
                log(`opening ${target.name}`)
                try {
                    await invoke('start_discord', { id: target.id })
                    for (let i = 0; i < 30; i++) {
                        await sleep(2000)
                        const now = await invoke<DiscordClient[]>('discord_status').catch(() => [] as DiscordClient[])
                        if (now.some(c => c.id === target.id && c.running)) {
                            // give it time to sign in and start detecting games
                            await sleep(20_000)
                            return { ok: true, opened: target.id }
                        }
                    }
                    log(`${target.name} didn't start`, 'warning')
                } catch (e) {
                    log(`couldn't open ${target.name}: ${e}`, 'warning')
                }
            }
        }
        if (cfg.requireDiscord) {
            setPhase('waiting-discord', cfg.openDiscord ? "Couldn't open Discord; will try again" : 'Waiting for Discord to be running')
            return { ok: false, opened: null }
        }
        return { ok: true, opened: null }
    }

    async function pickGame(s: Session): Promise<Game | null> {
        let pool = library.games.value.filter(g => defaultExecutable(g) && !isGameRunning(g) && !s.games.some(x => x.uid === g.uid))
        if (b.value.source === 'installed') {
            const ids = new Set(await invoke<string[]>('installed_game_ids').catch(() => [] as string[]))
            pool = pool.filter(g => ids.has(g.id))
        }
        if (pool.length === 0) return null
        // games not played yet today come first
        const fresh = pool.filter(g => !today.value.playedIds.includes(g.id))
        const from = fresh.length > 0 ? fresh : pool
        return from[Math.floor(Math.random() * from.length)]
    }

    async function manage() {
        const s = session.value
        if (!s) return
        const cfg = b.value
        const now = Date.now()

        for (const g of s.games) {
            if (g.done) continue
            const game = library.findByUid(g.uid)
            if (!game || !isGameRunning(game)) { g.done = true; continue }
            if (!g.endsAt) {
                const detected = runningExecutable(game)?.detected_at
                const timedOut = now - g.launchedAt > Math.max(10, settings.value.detectTimeoutSec) * 1000
                if (!cfg.waitForDiscord || !discord.available.value || detected || timedOut) {
                    g.endsAt = (detected ?? now) + g.minutes * 60_000
                }
            }
            if (g.endsAt && now >= g.endsAt) {
                await library.stop(game, undefined, { quiet: true })
                g.done = true
                log(`closed ${game.name} after ${g.minutes} min`)
            }
        }

        const active = s.games.filter(g => !g.done)
        const left = today.value.target - today.value.played
        if (left > 0 && active.length < Math.max(1, cfg.maxConcurrent) && now >= s.nextLaunchAt) {
            const game = await pickGame(s)
            if (game) {
                const minutes = randInt(cfg.sessionMinMinutes, cfg.sessionMaxMinutes)
                if (await library.launch(game, undefined, { quiet: true })) {
                    s.games.push({ uid: game.uid!, name: game.name, minutes, launchedAt: Date.now() })
                    today.value.played++
                    today.value.playedIds = [...today.value.playedIds, game.id]
                    log(`playing ${game.name} for ${minutes} min`)
                }
                s.nextLaunchAt = Date.now() + randInt(20, 90) * 1000
            } else if (active.length === 0) {
                return endSession('no games left to play')
            }
        }

        const stillActive = s.games.filter(g => !g.done)
        if (today.value.target - today.value.played <= 0 && stillActive.length === 0) {
            return endSession("today's games are done")
        }
        setPhase('playing', stillActive.length
            ? `Playing ${stillActive.map(g => g.name).join(', ')}`
            : 'Picking the next game…')
    }

    async function startSession(openedDiscord: string | null) {
        session.value = { startedAt: Date.now(), games: [], openedDiscord, nextLaunchAt: Date.now() }
        log(`you've been away ${Math.round(idleSeconds.value / 60)} min, starting to play`)
        await manage()
    }

    /** Ends the session: closes Buddy's games and, if asked, the Discord it opened. */
    async function endSession(reason: string, { userBack = false, keepDiscord = false } = {}) {
        const s = session.value
        if (!s) return
        session.value = null
        for (const g of s.games) {
            if (g.done) continue
            const game = library.findByUid(g.uid)
            if (game && isGameRunning(game)) await library.stop(game, undefined, { quiet: true })
        }
        if (s.openedDiscord && b.value.closeDiscordAfter && !keepDiscord) {
            // you're using the PC again: don't pull Discord out from under you
            if (userBack) log('left Discord open since you are back')
            else await invoke('close_discord', { id: s.openedDiscord }).catch(() => {})
        }
        lastRun.value = { at: Date.now(), games: s.games.map(g => g.name), reason }
        log(`session ended (${reason}); ${s.games.length} game${s.games.length === 1 ? '' : 's'} played`)
        if (!b.value.enabled) setPhase('off')
        else if (today.value.played >= today.value.target) setPhase('done-today', `Played ${today.value.played} game${today.value.played === 1 ? '' : 's'} today`)
        else if (userBack) setPhase('waiting-idle', "Stopped because you're back. It starts again once you're away.")
        else setPhase('waiting-idle', `Session ended: ${reason}`)
    }

    let ticking = false
    async function tick() {
        if (ticking) return
        ticking = true
        try {
            await step()
        } catch (e) {
            log(`something went wrong: ${e}`, 'warning')
        } finally {
            ticking = false
        }
    }

    async function step() {
        const cfg = b.value
        rollDay()
        if (!cfg.enabled) {
            if (session.value) await endSession('turned off')
            return setPhase('off')
        }
        if (!settings.value.riskAcceptedAt) return setPhase('blocked', 'Accept the risk notice first')
        if (!startup.enabled.value) return setPhase('blocked', 'Needs Launch on startup')

        idleSeconds.value = await invoke<number>('idle_seconds').catch(() => 0)
        const allowed = inAllowedHours(cfg)

        if (session.value) {
            if (cfg.stopWhenBack && idleSeconds.value < BACK_SECONDS) return endSession("you're back", { userBack: true })
            if (!allowed) return endSession('outside the allowed hours')
            return manage()
        }

        if (!allowed) return setPhase('outside-hours', 'Outside the hours and days you allowed')
        if (today.value.played >= today.value.target) {
            return setPhase('done-today', `Played ${today.value.played} game${today.value.played === 1 ? '' : 's'} today`)
        }
        if (scheduler.isActive.value) return setPhase('waiting-idle', 'Waiting for your timed run to finish')
        const needed = cfg.idleMinutes * 60
        if (idleSeconds.value < needed) {
            const left = Math.ceil((needed - idleSeconds.value) / 60)
            return setPhase('waiting-idle', `Starts once you've been away ${cfg.idleMinutes} min (${left} min to go)`)
        }
        const discordCheck = await ensureDiscord()
        if (!discordCheck.ok || !b.value.enabled) return
        await startSession(discordCheck.opened)
    }

    /** Panic Abort / "Stop session": end it right away. */
    function abort(reason = 'stopped') {
        if (!session.value) return false
        endSession(reason, { userBack: true, keepDiscord: true })
        return true
    }

    // Buddy needs Launch on startup: turning that off turns Buddy off too
    watch(() => startup.enabled.value, on => {
        if (!on && startup.available.value && b.value.enabled) {
            settings.value.buddy.enabled = false
            log('turned off because Launch on startup was turned off')
        }
    })

    watch(() => b.value.enabled, () => { tick() })
    setInterval(tick, TICK_MS)
    startup.ready.then(tick)

    return { phase, detail, session, today, idleSeconds, lastRun, abort, tick }
})
