import { createGlobalState } from '@vueuse/core'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { useGameLibrary } from './game-library'
import { useScheduler } from './scheduler'
import { useBuddy } from './legit-buddy'
import { useRpcState } from './rpc-state'
import { useGlobalState } from './app-state'

export interface PanicReport {
    at: number;
    /** library games that were running */
    stoppedGames: number;
    /** game windows found and ended that Questly wasn't tracking */
    strays: number;
    timerCancelled: boolean;
    buddyStopped: boolean;
    rpcCleared: boolean;
    ms: number;
}

/**
 * Panic Abort (title bar button or Ctrl+Shift+X): stops every game, the
 * timed run, Legitimate Buddy and the RPC test, then reports what it did.
 * Each step runs even if an earlier one fails.
 */
export const usePanic = createGlobalState(() => {
    const report = ref<PanicReport | null>(null)
    const busy = ref(false)

    async function panic() {
        if (busy.value) return
        busy.value = true
        const started = performance.now()
        const library = useGameLibrary()
        const scheduler = useScheduler()
        const buddy = useBuddy()
        const rpc = useRpcState()
        const { addLog } = useGlobalState()

        const timerCancelled = scheduler.isActive.value
        const rpcCleared = rpc.testConnected.value
        let stoppedGames = 0
        let strays = 0
        let buddyStopped = false
        try {
            if (timerCancelled) await scheduler.cancel({ stopGames: false, quiet: true }).catch(() => {})
            try { buddyStopped = buddy.abort('Panic Abort') } catch { /* keep going */ }
            stoppedGames = await library.stopAll({ quiet: true }).catch(() => 0) ?? 0
            // let those exit, so they aren't counted again below
            if (stoppedGames > 0) await new Promise(resolve => setTimeout(resolve, 350))
            // whatever is left: every game window, including ones Questly lost track of
            strays = await invoke<number>('kill_all_runners').catch(() => 0)
            await emit('event_disconnect').catch(() => {})
            rpc.testConnected.value = false
            library.markAllStopped()
        } finally {
            busy.value = false
        }
        const r: PanicReport = {
            at: Date.now(), stoppedGames, strays, timerCancelled, buddyStopped, rpcCleared,
            ms: Math.round(performance.now() - started),
        }
        addLog('warning', `Panic Abort: stopped ${stoppedGames} game(s), ended ${strays} stray window(s)`
            + `${timerCancelled ? ', cancelled the timed run' : ''}${buddyStopped ? ", ended Buddy's session" : ''}`
            + `${rpcCleared ? ', cleared the RPC test' : ''} in ${r.ms} ms`)
        report.value = r
    }

    return { report, busy, panic }
})
