// The web demo's pretend PC. It stands in for Questly's Rust backend: the
// real app UI calls the same commands it calls in the desktop app, and gets
// believable answers. Nothing here talks to Discord or touches your computer:
// launched games are cards on the fake desktop, Discord's detection is a
// timer, CPU load and "being away" are switches in the demo bar.
import { useToasts } from '@/composables/toasts'
import { useGameLibrary } from '@/composables/game-library'
import { useScheduler } from '@/composables/scheduler'
import { Pages, useGlobalState } from '@/composables/app-state'
import { useSettings } from '@/composables/settings'
import { inFrame, onHost, toHost, type Sim } from './bridge'

declare const __APP_VERSION__: string

const store = {
    get(key: string) { try { return localStorage.getItem(key) } catch { return null } },
    set(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* private mode */ } },
}

const KEYS = {
    libraryFile: 'questly.demo.libraryFile',
    autostart: 'questly.demo.autostart',
    installed: 'questly.demo.installed',
    seeded: 'questly.demo.seeded',
}

// ----- first visit: a few popular games, and game windows shown on the desktop -----
const SEED = [
    { id: '700136079562375258', name: 'VALORANT' },
    { id: '1402418703554842694', name: 'Fortnite' },
    { id: '762434991303950386', name: 'Genshin Impact' },
    { id: '356877880938070016', name: 'Rocket League' },
    { id: '542075586886107149', name: 'Apex Legends' },
    { id: '1314395942253756416', name: 'Marvel Rivals' },
]

const scene = new URLSearchParams(location.search).get('scene')

if (!store.get(KEYS.seeded) || scene) {
    store.set(KEYS.seeded, '1')
    store.set(KEYS.libraryFile, JSON.stringify({ version: 1, games: SEED }, null, 2))
    let settings: Record<string, unknown> = {}
    try { settings = JSON.parse(store.get('dqc.settings.v1') ?? '{}') } catch { /* fresh */ }
    settings.gameWindowMode = 'visible'
    if (scene) settings.riskAcceptedAt = Date.now()
    store.set('dqc.settings.v1', JSON.stringify(settings))
}

// ----- simulated PC -----
const sim: Sim = { discord: true, heavy: false, away: false }
let awaySince = 0
let lastInput = Date.now()
for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel']) {
    window.addEventListener(type, () => { lastInput = Date.now() }, { capture: true, passive: true })
}

/** games "running" on the pretend PC, by executable name */
const running = new Map<string, { appId: string; exe: string; name: string }>()
const installed = new Set<string>(JSON.parse(store.get(KEYS.installed) ?? '[]'))
let closeToTray = false
let splashStage = 0

function toast(kind: 'info' | 'success' | 'warning' | 'error', title: string, body?: string) {
    try { useToasts().toast(kind, title, body) } catch { /* app not mounted yet */ }
}

/** Discord writes local times like "2026-09-28 19:06:20.359" */
function logTime(d = new Date()) {
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** Pretend Discord noticed what's running (the real app reads this from Discord's log). */
function discordNotices(delay = 1800 + Math.random() * 2600) {
    setTimeout(() => {
        if (sim.discord && running.size > 0) {
            emit('discord_log_event', { kind: 'running_games_changed', time: logTime(), game: null, key: null, source: 'discord' })
        }
    }, delay)
}

// ----- Tauri event system -----
const callbacks = new Map<number, (event: unknown) => void>()
const listeners = new Map<string, Map<number, number>>() // event -> (eventId -> callback id)
let nextId = 1

function emit(event: string, payload: unknown) {
    for (const [eventId, cb] of listeners.get(event) ?? []) callbacks.get(cb)?.({ event, id: eventId, payload })
}

// ----- the game list (Discord's detectable games), served next to the site -----
let gameList: Promise<unknown> | null = null
const loadGameList = () => (gameList ??= fetch('/data/detectable.json').then(r => r.json()))

// ----- file dialogs: real browser downloads and file pickers -----
const pickedFiles = new Map<string, string>()

function pickFile(): Promise<string | null> {
    return new Promise(resolve => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,application/json'
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return resolve(null)
            const path = `C:\\Users\\you\\Downloads\\${file.name}`
            pickedFiles.set(path, await file.text())
            resolve(path)
        }
        input.addEventListener('cancel', () => resolve(null))
        input.click()
    })
}

function download(name: string, content: string) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
}

type Args = Record<string, any>

async function handle(cmd: string, args: Args): Promise<unknown> {
    switch (cmd) {
        // --- events ---
        case 'plugin:event|listen': {
            const eventId = nextId++
            if (!listeners.has(args.event)) listeners.set(args.event, new Map())
            listeners.get(args.event)!.set(eventId, args.handler)
            return eventId
        }
        case 'plugin:event|unlisten':
            listeners.get(args.event)?.delete(args.eventId)
            return null
        case 'plugin:event|emit':
        case 'plugin:event|emit_to':
            emit(args.event, args.payload)
            return null

        // --- window ---
        case 'plugin:window|minimize':
            toHost({ q: 'window', action: 'minimize' })
            return null
        case 'plugin:window|close':
            toHost({ q: 'window', action: closeToTray ? 'hide' : 'quit' })
            return null
        case 'hide_window':
            toHost({ q: 'window', action: 'hide' })
            if (!inFrame) toast('info', 'Hidden to the tray', 'In the desktop app the window would now be in the system tray.')
            return null
        case 'show_window':
            toHost({ q: 'window', action: 'show' })
            return null
        case 'quit_app':
            toHost({ q: 'window', action: 'quit' })
            return null
        case 'set_close_to_tray':
            closeToTray = !!args.enabled
            return null

        // --- startup splash ---
        case 'splash_stage':
            splashStage = Math.max(splashStage, args.stage)
            toHost({ q: 'stage', n: args.stage })
            if (args.stage >= 3) runScene()
            return null
        case 'get_splash_stage':
            return splashStage
        case 'finish_splash':
            toHost({ q: 'finish' })
            return null

        // --- accent-colored app icon: the demo's taskbar and tab icon ---
        case 'set_brand_icon': {
            const key = String(args.key ?? '')
            toHost({ q: 'icon', fill: `#${key.slice(2, 8)}`, glyph: `#${key.slice(8, 14)}` })
            return `C:\\Users\\you\\AppData\\Local\\Questly\\icons\\questly-${key}.ico`
        }
        case 'set_shortcut_icon':
            return null

        // --- installer: the demo is "installed" ---
        case 'install_info':
            return {
                current_exe: 'C:\\Users\\you\\AppData\\Local\\Programs\\Questly\\Questly.exe',
                install_dir: 'C:\\Users\\you\\AppData\\Local\\Programs\\Questly',
                installed_exe: 'C:\\Users\\you\\AppData\\Local\\Programs\\Questly\\Questly.exe',
                data_dir: 'C:\\Users\\you\\AppData\\Roaming\\Questly',
                running_installed: true,
                installed_exists: false,
                dev: false,
                uninstall_requested: false,
                autostarted: false,
                version: __APP_VERSION__,
            }

        // --- library.json (kept in this browser) ---
        case 'read_library_file': {
            const content = store.get(KEYS.libraryFile)
            return { path: 'C:\\Users\\you\\AppData\\Roaming\\Questly\\library.json', content, modified_ms: content ? 1 : 0 }
        }
        case 'write_library_file':
            store.set(KEYS.libraryFile, args.content)
            return Date.now()
        case 'reveal_library_file':
            toast('info', 'Opens File Explorer', 'In the desktop app this shows library.json in its folder.')
            return null
        case 'plugin:dialog|open':
            return pickFile()
        case 'plugin:dialog|save':
            return `C:\\Users\\you\\Downloads\\${args.options?.defaultPath ?? 'questly-library.json'}`
        case 'plugin:dialog|message':
        case 'plugin:dialog|ask':
        case 'plugin:dialog|confirm':
            return null
        case 'read_text_file': {
            const text = pickedFiles.get(args.path)
            if (text === undefined) throw new Error('That file is no longer available. Pick it again.')
            return text
        }
        case 'write_text_file':
            download(String(args.path).split('\\').pop() || 'questly-library.json', args.content)
            return null

        // --- the game list ---
        case 'fetch_gamelist_gh_mirror':
        case 'fetch_gamelist_from_discord':
            return loadGameList()

        // --- games ---
        case 'create_fake_game':
            return 'Dummy executable ready (simulated)'
        case 'run_background_process': {
            const exe = String(args.executable_name)
            const appId = String(args.app_id)
            running.set(exe.toLowerCase(), { appId, exe, name: args.name })
            installed.add(appId)
            store.set(KEYS.installed, JSON.stringify([...installed]))
            toHost({ q: 'game:start', appId, exe, name: args.name, icon: args.icon_url ?? null, colors: args.colors ?? null, mode: args.window_mode ?? 'parked' })
            discordNotices()
            return 'Process started (simulated)'
        }
        case 'stop_process': {
            const key = String(args.exec_name).toLowerCase()
            if (!running.has(key)) throw new Error('Process not found')
            running.delete(key)
            toHost({ q: 'game:stop', exe: key })
            return null
        }
        case 'set_game_windows_visible':
            toHost({ q: 'games:visible', visible: !!args.visible })
            return running.size
        case 'kill_all_runners': {
            const count = running.size
            running.clear()
            toHost({ q: 'games:killAll' })
            return count
        }
        case 'installed_game_ids':
            return [...installed]

        // --- Discord ---
        case 'discord_log_paths':
            return ['C:\\Users\\you\\AppData\\Roaming\\discord\\logs\\renderer_js.log']
        case 'discord_status':
            return [{ id: 'discord', name: 'Discord', installed: true, running: sim.discord }]
        case 'start_discord':
            setTimeout(() => setSim({ discord: true }, true), 2500)
            return null
        case 'close_discord':
            setSim({ discord: false }, true)
            return null
        case 'connect_to_discord_rpc_3':
            setTimeout(() => emit('client_connecting', {}), 100)
            setTimeout(() => emit('client_connected', {}), 700)
            toast('info', 'Simulated', 'In the demo nothing is sent to Discord.')
            return null

        // --- the PC: load, idle time, startup ---
        case 'system_load': {
            const r = Math.random()
            return sim.heavy
                ? { cpu: 92 + r * 6, memory: 88 + r * 4, cores: navigator.hardwareConcurrency || 8 }
                : { cpu: 11 + r * 17, memory: 46 + r * 6, cores: navigator.hardwareConcurrency || 8 }
        }
        case 'idle_seconds':
            return sim.away ? 3600 + Math.floor((Date.now() - awaySince) / 1000) : Math.floor((Date.now() - lastInput) / 1000)
        case 'get_autostart':
            return store.get(KEYS.autostart) === '1'
        case 'set_autostart':
            store.set(KEYS.autostart, args.enabled ? '1' : '0')
            return null

        case 'greet':
            return `Hello, ${args.name}!`
        default:
            // anything else (window focus, sizes…) doesn't matter in the browser
            return null
    }
}

function setSim(next: Partial<Sim>, tellHost = false) {
    const wasDiscord = sim.discord
    if (next.away && !sim.away) awaySince = Date.now()
    Object.assign(sim, next)
    // Discord just started: it picks up whatever is already running
    if (sim.discord && !wasDiscord) discordNotices(2500)
    if (tellHost) toHost({ q: 'sim', sim: next })
}

onHost(message => {
    if (message.q === 'sim') setSim(message.sim)
    else if (message.q === 'tray:stopAll') emit('tray_stop_all', null)
    else if (message.q === 'game:closed') {
        running.delete(message.exe.toLowerCase())
        emit('game_exited', { app_id: message.appId, executable_name: message.exe, code: message.code, deleted: message.code === 2 })
    }
})

// the title bar drags the window around the pretend desktop
window.addEventListener('mousedown', e => {
    const target = e.target as Element | null
    if (e.button === 0 && target?.hasAttribute?.('data-tauri-drag-region')) toHost({ q: 'drag:start', x: e.screenX, y: e.screenY })
}, true)

;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event: string, eventId: number) {
        listeners.get(event)?.delete(eventId)
    },
}

;(window as any).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    plugins: { path: { sep: '\\', delimiter: ';' } },
    transformCallback(callback: (event: unknown) => void, once = false) {
        const id = nextId++
        callbacks.set(id, event => {
            if (once) callbacks.delete(id)
            callback?.(event)
        })
        return id
    },
    unregisterCallback(id: number) {
        callbacks.delete(id)
    },
    convertFileSrc(path: string) {
        return path
    },
    invoke(cmd: string, args: Args = {}) {
        // answer asynchronously, like the real IPC
        return new Promise((resolve, reject) => {
            setTimeout(() => handle(cmd, args ?? {}).then(resolve, reject), cmd.startsWith('plugin:event') ? 0 : 60)
        })
    },
}

toHost({ q: 'ready' })

// ----- scenes: preset states used for the website's screenshots (?scene=…) -----
let sceneStarted = false
async function runScene() {
    if (!scene || sceneStarted) return
    sceneStarted = true
    // a headless browser has no focus: light up the title bar's traffic lights anyway
    window.dispatchEvent(new Event('focus'))
    const library = useGameLibrary()
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
    // the list fills in the games' details once Discord's game list is in
    for (let i = 0; i < 50 && library.games.value.some(g => g.executables.length === 0); i++) await wait(100)
    const games = library.games.value
    if (scene === 'library') {
        library.focusedUid.value = games[0].uid!
        await library.launch(games[0], undefined, { quiet: true })
        await library.launch(games[2], undefined, { quiet: true })
    } else if (scene === 'timer') {
        library.focusedUid.value = games[1].uid!
        useScheduler().start(games.slice(0, 4), 30 * 60, { mode: 'parallel', order: 'fixed', waitForDiscord: true })
    } else if (scene === 'settings') {
        const { settings } = useSettings()
        settings.value.accent = '#8ecbff'
        useGlobalState().setPage(Pages.SETTINGS)
    } else if (scene === 'search') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
        await wait(400)
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Search games"]')
        if (input) {
            input.value = 'counter'
            input.dispatchEvent(new Event('input'))
        }
    }
}
