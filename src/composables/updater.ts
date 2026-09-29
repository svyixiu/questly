import { createGlobalState } from '@vueuse/core'
import { ref, shallowRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** Mirrors UpdateInfo in src-tauri/src/update.rs */
export interface UpdateInfo {
    current: string;
    latest: string;
    available: boolean;
    /** release notes, Markdown as written on GitHub */
    notes: string;
    published_at: string;
    /** bytes to download */
    size: number;
    page: string;
}

export type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'installing' | 'error'

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

/**
 * Settings → About → Check for updates. Finding a newer version asks whether to
 * download it; the download shows its progress, is checked against GitHub's
 * checksum, and then Questly restarts into the new version by itself.
 */
export const useUpdater = createGlobalState(() => {
    const state = ref<UpdateState>('idle')
    const info = shallowRef<UpdateInfo | null>(null)
    const error = ref('')
    /** what failed: the check, or the download */
    const failed = ref<'check' | 'download'>('check')
    const checkedAt = ref<number | null>(null)
    const downloaded = ref(0)
    const total = ref(0)
    /** bytes per second, smoothed */
    const speed = ref(0)
    /** the "download it?" dialog */
    const dialogOpen = ref(false)

    let lastSample = { at: 0, bytes: 0 }
    listen<{ downloaded: number; total: number }>('update_progress', e => {
        const now = performance.now()
        if (lastSample.at && now > lastSample.at) {
            const instant = (e.payload.downloaded - lastSample.bytes) / ((now - lastSample.at) / 1000)
            speed.value = speed.value ? speed.value * 0.8 + instant * 0.2 : instant
        }
        lastSample = { at: now, bytes: e.payload.downloaded }
        downloaded.value = e.payload.downloaded
        total.value = e.payload.total || info.value?.size || 0
    }).catch(() => { /* not in the desktop app */ })

    async function check() {
        if (state.value === 'checking' || state.value === 'downloading' || state.value === 'installing') return
        state.value = 'checking'
        error.value = ''
        try {
            // a short pause keeps the spinner from just flickering on a fast connection
            const [result] = await Promise.all([invoke<UpdateInfo>('check_for_update'), new Promise(r => setTimeout(r, 500))])
            info.value = result
            checkedAt.value = Date.now()
            state.value = result.available ? 'available' : 'latest'
            if (result.available) dialogOpen.value = true
        } catch (e) {
            error.value = errorMessage(e)
            failed.value = 'check'
            state.value = 'error'
        }
    }

    /** Downloads the update, then quits and starts it. */
    async function download() {
        if (!info.value?.available || state.value === 'downloading' || state.value === 'installing') return
        state.value = 'downloading'
        error.value = ''
        downloaded.value = 0
        total.value = info.value.size
        speed.value = 0
        lastSample = { at: 0, bytes: 0 }
        try {
            await invoke('download_update')
            state.value = 'installing'
            dialogOpen.value = true
            // a moment to read "Restarting…" before the window goes
            await new Promise(r => setTimeout(r, 900))
            await invoke('install_update')
        } catch (e) {
            const message = errorMessage(e)
            if (message === 'cancelled') {
                state.value = 'available'
                return
            }
            error.value = message
            failed.value = 'download'
            state.value = 'error'
        }
    }

    function cancel() {
        invoke('cancel_update_download').catch(() => {})
    }

    function retry() {
        if (failed.value === 'download' && info.value?.available) download()
        else check()
    }

    return { state, info, error, failed, checkedAt, downloaded, total, speed, dialogOpen, check, download, cancel, retry }
})

/** "18.0 MB" */
export function formatBytes(bytes: number) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
    return `${bytes} B`
}

export interface NoteSection {
    title: string;
    items: string[];
}

/** The release notes' sections ("**New**" or "## New") and their bullet points, as plain text. */
export function parseReleaseNotes(markdown: string): NoteSection[] {
    const plain = (s: string) => s
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*|__|`/g, '')
        .trim()
    const sections: NoteSection[] = []
    let current: NoteSection | null = null
    for (const raw of markdown.split(/\r?\n/)) {
        const line = raw.trim()
        if (/^\*\*[^*]+\*\*:?$/.test(line) || /^#{1,6}\s+\S/.test(line)) {
            current = { title: plain(line.replace(/^#{1,6}\s+/, '').replace(/:$/, '')), items: [] }
            sections.push(current)
        } else if (current && /^[-*]\s+/.test(line)) {
            current.items.push(plain(line.replace(/^[-*]\s+/, '')))
        }
    }
    return sections.filter(s => s.items.length > 0)
}
