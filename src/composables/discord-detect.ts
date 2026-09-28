import { createGlobalState, useIntervalFn } from '@vueuse/core'
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useGameLibrary } from './game-library'
import { useGlobalState } from './app-state'

/** Shape emitted by the Rust log watcher (src-tauri/src/lib.rs). */
interface DiscordLogEvent {
    kind: 'running_games_changed' | 'primary_game';
    time: string;
    game: string | null;
    key: string | null;
    source: string;
}

/** Discord writes local times like "2026-09-28 19:06:20.359". */
function parseLogTime(time: string) {
    const ms = new Date(time.replace(' ', 'T')).getTime()
    return Number.isFinite(ms) ? ms : Date.now()
}

const CHANNEL_NAMES: Record<string, string> = {
    discord: 'Discord',
    discordptb: 'Discord PTB',
    discordcanary: 'Discord Canary',
    discorddevelopment: 'Discord Development',
}

/**
 * Knows when Discord has actually picked up a launched game, by following
 * the "Running Games Changed" lines Discord writes to its own client log.
 * Every running game launched before such a line is marked `detected_at`.
 */
export const useDiscordDetect = createGlobalState(() => {
    const library = useGameLibrary()
    const { addLog } = useGlobalState()

    const logPaths = ref<string[]>([])
    const available = computed(() => logPaths.value.length > 0)
    const clients = computed(() =>
        logPaths.value.map(p => {
            const channel = p.split(/[\\/]/).slice(-3, -2)[0]?.toLowerCase() ?? ''
            return CHANNEL_NAMES[channel] ?? channel
        })
    )
    const lastEventAt = ref<number | null>(null)
    /** the game Discord currently treats as the main one, if it says */
    const primaryGame = ref<string | null>(null)

    async function refreshPaths() {
        try {
            logPaths.value = await invoke<string[]>('discord_log_paths')
        } catch {
            logPaths.value = [] // not running inside the desktop app
        }
    }
    refreshPaths()
    // Discord may be installed or started after us
    useIntervalFn(refreshPaths, 30_000)

    function markDetected(at: number, match?: (gameId: string) => boolean) {
        for (const game of library.games.value) {
            if (match && !match(game.id)) continue
            for (const exe of game.executables) {
                if (!exe.is_running || exe.detected_at || !exe.launch_requested_at) continue
                if (exe.launch_requested_at <= at) {
                    exe.detected_at = at
                    addLog('info', `Discord detected ${game.name}`)
                }
            }
        }
    }

    listen<DiscordLogEvent>('discord_log_event', ({ payload }) => {
        const at = parseLogTime(payload.time)
        lastEventAt.value = at
        if (payload.kind === 'running_games_changed') {
            // Discord re-scanned and its list of running games changed:
            // anything we started before this moment is now in that list.
            markDetected(at)
        } else {
            primaryGame.value = payload.game
            // "…/games/<app id>/…" in the key pins it to one of our dummy games
            const key = payload.key?.toLowerCase().replace(/\\/g, '/') ?? ''
            if (key) markDetected(at, id => key.includes(`/games/${id}/`))
        }
    }).catch(() => {})

    return { logPaths, available, clients, lastEventAt, primaryGame, refreshPaths }
})
