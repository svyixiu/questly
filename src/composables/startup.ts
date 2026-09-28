import { createGlobalState } from '@vueuse/core'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/**
 * Launch on startup: a per-user "Run" entry that starts Questly quietly in
 * the tray when you sign in to Windows (no splash, no window).
 */
export const useStartup = createGlobalState(() => {
    const enabled = ref(false)
    /** false outside the desktop app */
    const available = ref(false)
    const busy = ref(false)

    const ready = invoke<boolean>('get_autostart')
        .then(on => {
            enabled.value = on
            available.value = true
        })
        .catch(() => {})

    async function set(on: boolean) {
        busy.value = true
        try {
            await invoke('set_autostart', { enabled: on })
            enabled.value = on
        } finally {
            busy.value = false
        }
    }

    return { enabled, available, busy, ready, set }
})
