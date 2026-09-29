import { createGlobalState, useEventListener, watchDebounced } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { sep } from '@tauri-apps/api/path'
import type { Game, GameExecutable } from '@/types/types'
import { randomString } from '@/utils/random-string'
import { themeColorsForGameWindow } from '@/theme/themes'
import {
    defaultExecutable,
    gameIconUrl,
    getExecutablePath,
    getFilename,
    isGameRunning,
    splitExecutableName,
} from '@/utils/executables'
import { useGlobalState } from './app-state'
import { useToasts } from './toasts'
import { useGameDB } from './game-db'
import { hideWindow, setGameWindowsVisible, useSettings } from './settings'

/** Fallback copy (and the only store when running outside the desktop app). */
const STORAGE_KEY = 'dqc.library.v1'

type StoredExe = Pick<GameExecutable, 'name' | 'os' | 'is_launcher'>
type StoredGame = Pick<Game, 'id' | 'name' | 'aliases' | 'icon_hash' | 'selected_exe'> & {
    executables: StoredExe[]
}

const FILE_README =
    'Games in your Questly library. You can edit this file, with the app open or closed. ' +
    'To add a game, an entry only needs its Discord application id, e.g. { "id": "700136079562375258" }, ' +
    'or its exact name, e.g. { "name": "VALORANT" }; the rest is filled in automatically. ' +
    'Optional: "selected_exe" picks which executable Play and timers use. ' +
    'Changes are picked up when the app window regains focus.'

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

/** Copies only what the library needs, so runtime flags never leak into the game DB. */
function toLibraryGame(game: Partial<Game> & { id: string }): Game {
    return {
        uid: randomString(),
        id: String(game.id),
        name: game.name ?? `Unknown game ${game.id}`,
        aliases: game.aliases ? [...game.aliases] : [],
        icon_hash: game.icon_hash ?? null,
        selected_exe: game.selected_exe,
        executables: (game.executables ?? []).map(exe => ({
            name: exe.name,
            os: exe.os,
            is_launcher: !!exe.is_launcher,
        })),
    }
}

function toStored(g: Game): StoredGame {
    return {
        id: g.id,
        name: g.name,
        ...(g.selected_exe ? { selected_exe: g.selected_exe } : {}),
        icon_hash: g.icon_hash ?? null,
        aliases: g.aliases ?? [],
        executables: g.executables.map(({ name, os, is_launcher }) => ({ name, os, is_launcher })),
    }
}

function serializeFile(games: Game[]) {
    return JSON.stringify({ _readme: FILE_README, version: 1, games: games.map(toStored) }, null, 2) + '\n'
}

type FileEntry = Partial<StoredGame> & { id?: string | number; name?: string }

/** Accepts `{ games: [...] }` or a bare array. Throws with a readable message. */
function parseFile(content: string): FileEntry[] {
    const data = JSON.parse(content)
    const list = Array.isArray(data) ? data : data?.games
    if (!Array.isArray(list)) throw new Error('expected a "games" array')
    list.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') throw new Error(`games[${i}] is not an object`)
        if (entry.id == null && !entry.name) throw new Error(`games[${i}] needs an "id" or a "name"`)
    })
    return list
}

function loadLocalGames(): Game[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.map(toLibraryGame) : []
    } catch {
        return []
    }
}

function saveLocalGames(games: Game[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(games.map(toStored)))
    } catch {
        // storage unavailable
    }
}

interface LibraryFile {
    path: string;
    content: string | null;
    modified_ms: number;
}

/** Adds the path/filename/segments fields the Rust commands need. */
function toLaunchable(executable: GameExecutable) {
    return {
        path: getExecutablePath(executable, sep()),
        filename: getFilename(executable)!,
        segments: splitExecutableName(executable).length,
    }
}

export const useGameLibrary = createGlobalState(() => {
    const { addLog } = useGlobalState()
    const { toast } = useToasts()
    const { settings } = useSettings()
    const { gameDB } = useGameDB()

    const games = ref<Game[]>(loadLocalGames())
    const checked = ref(new Set<string>())
    const focusedUid = ref<string | null>(games.value[0]?.uid ?? null)
    /** uids of games with a launch/stop in flight */
    const busy = ref(new Set<string>())
    const batchBusy = ref<'launch' | 'stop' | null>(null)

    const addedIds = computed(() => new Set(games.value.map(g => g.id)))
    const runningGames = computed(() => games.value.filter(isGameRunning))
    const checkedGames = computed(() => games.value.filter(g => checked.value.has(g.uid!)))
    const focusedGame = computed(() => games.value.find(g => g.uid === focusedUid.value) ?? null)

    // ----- library.json -----

    const libraryFile = ref<{ path: string; available: boolean; error: string | null }>({
        path: '', available: false, error: null,
    })
    let lastModified = 0
    let lastWritten = ''

    /** Fills in entries that only have an id or a name, from Discord's game list. */
    function resolveFromDB(entry: FileEntry): Partial<Game> & { id: string } {
        const db = gameDB.value
        const byId = entry.id != null ? db.find(g => String(g.id) === String(entry.id)) : undefined
        const byName = !byId && entry.name
            ? db.find(g => g.name.toLowerCase() === String(entry.name).toLowerCase())
            : undefined
        const found = byId ?? byName
        const hasExes = Array.isArray(entry.executables) && entry.executables.length > 0
        return {
            ...(found ?? {}),
            ...entry,
            id: String(entry.id ?? found?.id ?? `name:${entry.name}`),
            name: entry.name ?? found?.name,
            icon_hash: entry.icon_hash ?? found?.icon_hash ?? null,
            executables: hasExes ? entry.executables as GameExecutable[] : (found?.executables ?? []),
        }
    }

    /** Replaces the library with the file's list, keeping running games' state. */
    function applyEntries(entries: FileEntry[]) {
        const next: Game[] = []
        const seen = new Set<string>()
        for (const entry of entries) {
            const resolved = resolveFromDB(entry)
            if (seen.has(resolved.id)) continue
            seen.add(resolved.id)
            const existing = games.value.find(g => g.id === resolved.id)
            if (existing) {
                existing.name = resolved.name ?? existing.name
                existing.selected_exe = resolved.selected_exe
                if (resolved.icon_hash) existing.icon_hash = resolved.icon_hash
                if (existing.executables.length === 0 && resolved.executables?.length) {
                    existing.executables = resolved.executables.map(e => ({ name: e.name, os: e.os, is_launcher: !!e.is_launcher }))
                }
                next.push(existing)
            } else {
                next.push(toLibraryGame(resolved))
            }
        }
        // games removed from the file: stop them if they're running
        for (const old of games.value) {
            if (!seen.has(old.id) && isGameRunning(old)) stop(old, undefined, { quiet: true })
        }
        games.value = next
        if (!games.value.some(g => g.uid === focusedUid.value)) focusedUid.value = games.value[0]?.uid ?? null
        checked.value.forEach(uid => { if (!games.value.some(g => g.uid === uid)) checked.value.delete(uid) })
    }

    /** Reads library.json; creates it from the current list the first time. */
    async function syncFromFile({ force = false, announce = false } = {}) {
        let file: LibraryFile
        try {
            file = await invoke<LibraryFile>('read_library_file')
        } catch {
            return // not running inside the desktop app
        }
        libraryFile.value.path = file.path
        libraryFile.value.available = true
        if (file.content === null) {
            await writeFile(true)
            return
        }
        if (!force && file.modified_ms === lastModified) return
        lastModified = file.modified_ms
        try {
            const entries = parseFile(file.content)
            libraryFile.value.error = null
            lastWritten = file.content
            applyEntries(entries)
            addLog('info', `Loaded ${entries.length} game(s) from library.json`)
            if (announce) toast('success', 'Library reloaded', `${games.value.length} game${games.value.length === 1 ? '' : 's'} from library.json`)
        } catch (error) {
            // keep the current list and don't overwrite the file until it's fixed
            libraryFile.value.error = errorMessage(error)
            addLog('error', `library.json has an error: ${errorMessage(error)}`)
            toast('error', 'library.json has an error', `${errorMessage(error)}. Fix the file, then switch back to the app.`, 8000)
        }
    }

    async function writeFile(force = false) {
        if (!libraryFile.value.available && !force) return
        if (libraryFile.value.error) return
        const content = serializeFile(games.value)
        if (content === lastWritten) return
        try {
            lastModified = await invoke<number>('write_library_file', { content })
            lastWritten = content
        } catch (error) {
            addLog('error', `Couldn't save library.json: ${errorMessage(error)}`)
        }
    }

    // ----- import / export -----

    /** The library as shareable JSON (same format as library.json). */
    function exportText() {
        return serializeFile(games.value)
    }

    /** Validates an imported file; throws a readable error. */
    function parseLibraryText(text: string) {
        return parseFile(text)
    }

    /** How an import would change the library, for the confirmation dialog. */
    function previewImport(entries: FileEntry[]) {
        const ids = new Set(entries.map(e => String(resolveFromDB(e).id)))
        const fresh = [...ids].filter(id => !addedIds.value.has(id)).length
        return { total: ids.size, fresh, duplicates: ids.size - fresh }
    }

    /** 'replace': the file becomes the library. 'merge': keep yours, add what's new. */
    function importEntries(entries: FileEntry[], mode: 'replace' | 'merge') {
        const before = games.value.length
        if (mode === 'replace') {
            applyEntries(entries)
        } else {
            const current: FileEntry[] = games.value.map(toStored)
            const known = new Set(games.value.map(g => g.id))
            const additions = entries.filter(e => !known.has(String(resolveFromDB(e).id)))
            applyEntries([...current, ...additions])
        }
        const count = games.value.length
        addLog('info', `Imported a library (${mode}): ${before} → ${count} games`)
        toast('success', mode === 'replace' ? 'Library replaced' : 'Games added',
            mode === 'replace' ? `${count} game${count === 1 ? '' : 's'} imported.` : `${count - before} new, ${count} in total.`)
    }

    async function revealFile() {
        try {
            await invoke('reveal_library_file')
        } catch (error) {
            toast('error', "Couldn't open the folder", errorMessage(error))
        }
    }

    watchDebounced(games, value => {
        saveLocalGames(value)
        writeFile()
    }, { deep: true, debounce: 400 })

    // entries added by id/name only get their details once Discord's game list is loaded
    watch(() => gameDB.value.length, () => {
        for (const g of games.value) {
            if (g.executables.length > 0 && !g.name.startsWith('Unknown game')) continue
            const r = resolveFromDB({ id: g.id.startsWith('name:') ? undefined : g.id, name: g.id.startsWith('name:') ? g.id.slice(5) : undefined })
            if (!r.executables?.length) continue
            g.id = r.id
            g.name = r.name ?? g.name
            g.icon_hash = r.icon_hash ?? g.icon_hash
            g.aliases = r.aliases ?? g.aliases
            g.executables = r.executables.map(e => ({ name: e.name, os: e.os, is_launcher: !!e.is_launcher }))
        }
    })

    /** resolves once library.json has been read (for the startup splash) */
    const ready = syncFromFile({ force: true })
    // pick up hand edits when you come back to the app
    useEventListener(window, 'focus', () => { syncFromFile() })

    // ----- library editing -----

    function findByUid(uid: string) {
        return games.value.find(g => g.uid === uid)
    }

    function addGame(game: Game): Game {
        const existing = games.value.find(g => g.id === game.id)
        if (existing) return existing
        games.value.push(toLibraryGame(game))
        // return the reactive copy, so later mutations update the UI
        const added = games.value[games.value.length - 1]
        focusedUid.value = added.uid!
        addLog('info', `Added game: ${game.name}`)
        return added
    }

    /** Adds several games at once (one save, one log line). Returns the library copies of the new ones. */
    function addGames(list: Game[]): Game[] {
        const known = addedIds.value
        const fresh = list.filter((g, i) => !known.has(g.id) && list.findIndex(o => o.id === g.id) === i)
        if (fresh.length === 0) return []
        games.value.push(...fresh.map(toLibraryGame))
        const added = games.value.slice(-fresh.length)
        focusedUid.value = added[0].uid!
        const names = fresh.slice(0, 5).map(g => g.name).join(', ')
        addLog('info', `Added ${fresh.length} game${fresh.length === 1 ? '' : 's'}: ${names}${fresh.length > 5 ? ` and ${fresh.length - 5} more` : ''}`)
        return added
    }

    async function removeGames(uids: string[]) {
        const toRemove = games.value.filter(g => uids.includes(g.uid!))
        for (const game of toRemove) {
            if (isGameRunning(game)) await stop(game)
        }
        const index = games.value.findIndex(g => g.uid === focusedUid.value)
        games.value = games.value.filter(g => !uids.includes(g.uid!))
        uids.forEach(uid => checked.value.delete(uid))
        if (focusedUid.value && uids.includes(focusedUid.value)) {
            // keep focus near where it was so keyboard users don't lose their place
            const next = games.value[Math.min(Math.max(index, 0), games.value.length - 1)]
            focusedUid.value = next?.uid ?? null
        }
    }

    function removeGame(game: Game) {
        return removeGames([game.uid!])
    }

    function setSelectedExe(game: Game, exeName: string) {
        game.selected_exe = exeName
    }

    // ----- checkmarks -----

    function toggleChecked(uid: string, value?: boolean) {
        const next = value ?? !checked.value.has(uid)
        if (next) checked.value.add(uid)
        else checked.value.delete(uid)
    }

    const allChecked = computed(() =>
        games.value.length > 0 && games.value.every(g => checked.value.has(g.uid!))
    )

    function toggleAllChecked() {
        if (allChecked.value) checked.value.clear()
        else games.value.forEach(g => checked.value.add(g.uid!))
    }

    // ----- process control -----

    async function launch(game: Game, executable?: GameExecutable, { quiet = false } = {}) {
        const exe = executable ?? defaultExecutable(game)
        if (!exe) {
            if (!quiet) toast('error', `${game.name} can't be launched`, 'Discord has no executable registered for this game.')
            return false
        }
        if (exe.is_running) return true

        const { path, filename, segments } = toLaunchable(exe)
        busy.value.add(game.uid!)
        try {
            if (!exe.is_installed) {
                await invoke('create_fake_game', {
                    path,
                    executable_name: filename,
                    path_len: segments,
                    app_id: game.id, // text: Discord ids are too big for JS numbers
                    display_name: game.name,
                })
                exe.is_installed = true
            }
            // Discord's detection has to come after this moment to count
            exe.launch_requested_at = Date.now()
            exe.detected_at = undefined
            await invoke('run_background_process', {
                name: game.name,
                path,
                executable_name: filename,
                path_len: segments,
                app_id: game.id, // text: Discord ids are too big for JS numbers
                // with Auto hide on, games start without a window or tray icon
                window_mode: settings.value.autoHide ? 'hidden' : settings.value.gameWindowMode,
                // the game window shows the icon in Questly's current colors
                icon_url: gameIconUrl(game, 128),
                colors: themeColorsForGameWindow(),
            })
            exe.is_running = true
            exe.started_at = Date.now()
            addLog('info', `Playing game: ${game.name} (${exe.name})`)
            if (!quiet) toast('success', `Playing ${game.name}`, exe.name)
            return true
        } catch (error) {
            addLog('error', `Failed to launch ${game.name}: ${errorMessage(error)}`)
            if (!quiet) toast('error', `Couldn't launch ${game.name}`, errorMessage(error))
            return false
        } finally {
            busy.value.delete(game.uid!)
        }
    }

    /**
     * The backend stops processes by image name (taskkill /IM), which ends
     * every process with that filename. Mirror that in the UI state.
     */
    function markStopped(filename: string) {
        const target = filename.toLowerCase()
        for (const g of games.value) {
            for (const exe of g.executables) {
                if (exe.is_running && getFilename(exe)?.toLowerCase() === target) {
                    exe.is_running = false
                    exe.started_at = undefined
                    exe.launch_requested_at = undefined
                    exe.detected_at = undefined
                }
            }
        }
    }

    // A game closed from its own window: "Close" (exit 0) or "Close & delete"
    // (exit 2, its files are removed). Our own stops also end up here; those
    // are already marked stopped, so nothing is announced twice.
    listen<{ app_id: string; executable_name: string; code: number; deleted: boolean }>('game_exited', ({ payload }) => {
        const game = games.value.find(g => g.id === payload.app_id)
        const target = payload.executable_name.toLowerCase()
        const wasRunning = !!game?.executables.some(e => e.is_running && getFilename(e)?.toLowerCase() === target)
        if (wasRunning) markStopped(payload.executable_name)
        if (payload.deleted && game) game.executables.forEach(e => { e.is_installed = false })
        if (!game || !wasRunning) return
        if (payload.code === 2) {
            addLog('info', `${game.name} was closed from its window and its game files were deleted`)
            toast('info', `Closed ${game.name}`, payload.deleted ? 'Its game files were deleted too.' : "Its game files couldn't all be deleted.")
        } else if (payload.code === 0) {
            addLog('info', `${game.name} was closed from its window`)
            toast('info', `Closed ${game.name}`)
        }
    }).catch(() => {})

    async function stopFilename(filename: string) {
        try {
            await invoke('stop_process', { exec_name: filename })
            return true
        } catch (error) {
            // Usually means the process already exited; the state is reset either way.
            addLog('error', `Failed to stop ${filename}: ${errorMessage(error)}`)
            return false
        } finally {
            markStopped(filename)
        }
    }

    async function stop(game: Game, executable?: GameExecutable, { quiet = false } = {}) {
        const targets = executable ? [executable] : game.executables.filter(e => e.is_running)
        if (targets.length === 0) return
        busy.value.add(game.uid!)
        try {
            for (const exe of targets) {
                await stopFilename(getFilename(exe)!)
            }
            addLog('info', `Stopped game: ${game.name}`)
            if (!quiet) toast('info', `Stopped ${game.name}`)
        } finally {
            busy.value.delete(game.uid!)
        }
    }

    /** Settings > Auto hide: tuck the window (and game windows) away after launching. */
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    function maybeAutoHide() {
        if (!settings.value.autoHide || hideTimer) return
        toast('info', 'Hiding to the tray…', 'Click the tray icon to bring the window back.', 1500)
        hideTimer = setTimeout(() => {
            hideTimer = null
            hideWindow()
            // also tuck away games that were started before Auto hide was on
            setGameWindowsVisible(false)
        }, 1400)
    }

    async function toggle(game: Game) {
        if (busy.value.has(game.uid!)) return
        if (isGameRunning(game)) return stop(game)
        if (await launch(game)) maybeAutoHide()
    }

    async function launchMany(targets: Game[]) {
        const pending = targets.filter(g => !isGameRunning(g))
        if (pending.length === 0) {
            toast('info', 'Everything is already running')
            return 0
        }
        batchBusy.value = 'launch'
        let ok = 0
        const failed: string[] = []
        try {
            for (const game of pending) {
                if (await launch(game, undefined, { quiet: true })) ok++
                else failed.push(game.name)
            }
        } finally {
            batchBusy.value = null
        }
        if (failed.length === 0) {
            toast('success', `Launched ${ok} game${ok === 1 ? '' : 's'}`)
        } else {
            toast('error', `Launched ${ok} of ${pending.length}`, `Failed: ${failed.join(', ')}. See the activity log.`)
        }
        if (ok > 0) maybeAutoHide()
        return ok
    }

    async function stopAll({ quiet = false } = {}) {
        const filenames = new Set<string>()
        for (const g of games.value) {
            for (const exe of g.executables) {
                if (exe.is_running) filenames.add(getFilename(exe)!.toLowerCase())
            }
        }
        if (filenames.size === 0) return 0
        const count = runningGames.value.length
        batchBusy.value = 'stop'
        try {
            await Promise.all([...filenames].map(stopFilename))
        } finally {
            batchBusy.value = null
        }
        addLog('info', `Stopped all games (${count})`)
        if (!quiet) toast('info', `Stopped ${count} game${count === 1 ? '' : 's'}`)
        return count
    }

    /** Panic Abort: forget every running/launch state, whatever happened to the processes. */
    function markAllStopped() {
        for (const g of games.value) {
            for (const exe of g.executables) {
                exe.is_running = false
                exe.started_at = undefined
                exe.launch_requested_at = undefined
                exe.detected_at = undefined
            }
        }
        busy.value.clear()
        batchBusy.value = null
    }

    return {
        games,
        checked,
        checkedGames,
        allChecked,
        focusedUid,
        focusedGame,
        busy,
        batchBusy,
        addedIds,
        runningGames,
        libraryFile,
        ready,
        syncFromFile,
        revealFile,
        exportText,
        parseLibraryText,
        previewImport,
        importEntries,
        findByUid,
        addGame,
        addGames,
        removeGame,
        removeGames,
        setSelectedExe,
        toggleChecked,
        toggleAllChecked,
        launch,
        stop,
        toggle,
        maybeAutoHide,
        launchMany,
        stopAll,
        markAllStopped,
    }
})
