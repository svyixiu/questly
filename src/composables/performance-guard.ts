import { createGlobalState, useDocumentVisibility } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSettings, type GuardSensitivity } from './settings'
import { useGlobalState } from './app-state'
import { useToasts } from './toasts'

export interface SystemLoad {
    cpu: number;
    memory: number;
    cores: number;
}

/** Above these, the PC counts as under heavy load. */
const THRESHOLDS: Record<GuardSensitivity, { cpu: number; memory: number; stutter: number }> = {
    relaxed: { cpu: 92, memory: 93, stutter: 0.35 },
    balanced: { cpu: 85, memory: 88, stutter: 0.22 },
    strict: { cpu: 75, memory: 82, stutter: 0.12 },
}

const SAMPLE_MS = 2000
/** sustained load for this many samples in a row before games are closed */
const HOT_SAMPLES = 2
/** and calm for this many before the cap is raised again */
const CALM_SAMPLES = 8

/**
 * Performance Guard: during timed runs it watches CPU, memory and how
 * smoothly this window renders. When the PC struggles it lowers `limit`, the
 * most games a timed run keeps open at once; the scheduler closes games over
 * the limit and brings them back (with their remaining time) once things calm down.
 */
export const usePerformanceGuard = createGlobalState(() => {
    const { settings } = useSettings()
    const { addLog } = useGlobalState()
    const { toast } = useToasts()
    const visibility = useDocumentVisibility()

    const enabled = computed(() => settings.value.perfGuard.enabled)
    const thresholds = computed(() => THRESHOLDS[settings.value.perfGuard.sensitivity] ?? THRESHOLDS.balanced)

    const load = ref<SystemLoad | null>(null)
    /** share of recent frames that took far too long (0..1) */
    const stutter = ref(0)
    /** most games a timed run may keep open; null = no cap */
    const limit = ref<number | null>(null)
    const hot = ref(false)
    /** what the guard last did, for the status line */
    const lastAction = ref<{ at: number; text: string } | null>(null)
    const available = ref(true)

    /** timed runs in progress (the scheduler calls begin/end) */
    const activeRuns = ref(0)
    /** anyone showing live numbers (the Settings card) */
    const viewers = ref(0)
    /** how many games the current run has open, and has in total (reported by the scheduler) */
    let openGames = () => 0
    let runSize = () => Infinity

    const sampling = computed(() => (enabled.value && activeRuns.value > 0) || viewers.value > 0)

    // ----- stutter: long frames while the window is visible -----
    let frames = 0
    let longFrames = 0
    let lastFrame = 0
    let raf = 0
    function frame(t: number) {
        if (lastFrame && t - lastFrame < 1000) {
            frames++
            if (t - lastFrame > 50) longFrames++
        }
        lastFrame = t
        raf = requestAnimationFrame(frame)
    }
    watch([sampling, visibility], ([on, vis]) => {
        cancelAnimationFrame(raf)
        lastFrame = 0
        if (on && vis === 'visible') raf = requestAnimationFrame(frame)
        else stutter.value = 0
    }, { immediate: true })

    // ----- sampling -----
    let timer: ReturnType<typeof setTimeout> | undefined
    let hotStreak = 0
    let calmStreak = 0
    let lastChange = 0
    const cpuHistory: number[] = []

    async function sample() {
        timer = undefined
        if (!sampling.value) return
        try {
            load.value = await invoke<SystemLoad>('system_load')
            available.value = true
        } catch {
            available.value = false
        }
        if (frames > 10) stutter.value = longFrames / frames
        frames = 0
        longFrames = 0
        if (load.value) {
            cpuHistory.push(load.value.cpu)
            if (cpuHistory.length > 3) cpuHistory.shift()
        }
        if (enabled.value && activeRuns.value > 0) evaluate()
        timer = setTimeout(sample, SAMPLE_MS)
    }

    watch(sampling, on => {
        clearTimeout(timer)
        timer = undefined
        if (on) {
            cpuHistory.length = 0
            // the first reading only primes the CPU counters
            invoke('system_load').catch(() => {}).finally(() => { timer = setTimeout(sample, 600) })
        }
    }, { immediate: true })

    function evaluate() {
        const l = load.value
        if (!l) return
        const t = thresholds.value
        // CPU: the average of the last two samples, so a single spike doesn't count
        const cpu = cpuHistory.slice(-2).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(2, cpuHistory.length))
        const reasons: string[] = []
        if (cpu >= t.cpu) reasons.push(`CPU ${Math.round(cpu)}%`)
        if (l.memory >= t.memory) reasons.push(`memory ${Math.round(l.memory)}%`)
        if (stutter.value >= t.stutter) reasons.push('stutter')
        hot.value = reasons.length > 0
        const calm = cpu < t.cpu - 15 && l.memory < t.memory - 5 && stutter.value < t.stutter / 2

        const now = Date.now()
        const open = openGames()
        if (hot.value) {
            hotStreak++
            calmStreak = 0
            if (hotStreak >= HOT_SAMPLES && now - lastChange > 8000 && open > 1) {
                const next = Math.max(1, open - 1)
                if (limit.value === null || next < limit.value) {
                    limit.value = next
                    lastChange = now
                    const text = `Heavy load (${reasons.join(', ')}): keeping at most ${next} game${next === 1 ? '' : 's'} open`
                    lastAction.value = { at: now, text }
                    addLog('warning', `Performance Guard: ${text}`)
                    toast('warning', 'Performance Guard stepped in', `${reasons.join(', ')}. Keeping at most ${next} game${next === 1 ? '' : 's'} open; the rest resume when things calm down.`, 7000)
                }
            }
        } else {
            hotStreak = 0
            calmStreak = calm ? calmStreak + 1 : 0
            if (limit.value !== null && calmStreak >= CALM_SAMPLES && now - lastChange > 15000) {
                limit.value++
                // enough room for every game of the run: no limit at all
                if (limit.value >= runSize()) limit.value = null
                lastChange = now
                calmStreak = 0
                const text = limit.value === null
                    ? 'Load is back to normal: no limit anymore'
                    : `Load is back to normal: allowing ${limit.value} games at once`
                lastAction.value = { at: now, text }
                addLog('info', `Performance Guard: ${text}`)
            }
        }
    }

    // turned off mid-run: lift the cap right away
    watch(enabled, on => {
        if (!on) {
            limit.value = null
            hot.value = false
        }
    })

    /** The scheduler calls this when a timed run starts. */
    function begin(countOpen: () => number, countTotal: () => number) {
        openGames = countOpen
        runSize = countTotal
        activeRuns.value++
        limit.value = null
        hotStreak = 0
        calmStreak = 0
        lastChange = 0
    }

    function end() {
        activeRuns.value = Math.max(0, activeRuns.value - 1)
        if (activeRuns.value === 0) {
            limit.value = null
            hot.value = false
            openGames = () => 0
            runSize = () => Infinity
        }
    }

    /** Live numbers while a view is open (returns a stop function). */
    function watchLive() {
        viewers.value++
        return () => { viewers.value = Math.max(0, viewers.value - 1) }
    }

    return { enabled, thresholds, load, stutter, limit, hot, lastAction, available, activeRuns, begin, end, watchLive }
})
