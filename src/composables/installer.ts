import { createGlobalState } from '@vueuse/core'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/** Mirrors InstallInfo in src-tauri/src/lib.rs */
export interface InstallInfo {
    current_exe: string;
    install_dir: string;
    installed_exe: string;
    data_dir: string;
    running_installed: boolean;
    installed_exists: boolean;
    dev: boolean;
    uninstall_requested: boolean;
    /** started by Windows at sign-in (Launch on startup) */
    autostarted: boolean;
    version: string;
}

export type ShellMode = 'loading' | 'installer' | 'uninstall' | 'app'

const PORTABLE_KEY = 'questly.portable'

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

/**
 * The same Questly.exe is the installer and the app: started from anywhere
 * other than its install folder it shows the installer first.
 */
export const useInstaller = createGlobalState(() => {
    const info = ref<InstallInfo | null>(null)
    const mode = ref<ShellMode>('loading')

    let portable = false
    try { portable = sessionStorage.getItem(PORTABLE_KEY) === '1' } catch { /* ignore */ }

    /** resolves once it's decided which screen to show */
    const ready = invoke<InstallInfo>('install_info')
        .then(i => {
            info.value = i
            if (i.uninstall_requested) mode.value = 'uninstall'
            else if (!i.running_installed && !i.dev && !portable) mode.value = 'installer'
            else mode.value = 'app'
        })
        // not inside the desktop app (e.g. a browser preview)
        .catch(() => { mode.value = 'app' })

    async function install(desktopShortcut: boolean, startMenu: boolean) {
        try {
            const path = await invoke<string>('install_app', { desktopShortcut, startMenu })
            if (info.value) info.value.installed_exists = true
            return { ok: true as const, path }
        } catch (error) {
            return { ok: false as const, error: errorMessage(error) }
        }
    }

    function launchInstalled() {
        return invoke('launch_installed').catch(error => { throw new Error(errorMessage(error)) })
    }

    /** Use the app straight from where it is, without installing (this session only). */
    function runPortable() {
        try { sessionStorage.setItem(PORTABLE_KEY, '1') } catch { /* ignore */ }
        mode.value = 'app'
    }

    function openUninstall() {
        mode.value = 'uninstall'
    }

    function cancelUninstall() {
        // opened from "Apps & features": there's nothing else to go back to
        if (info.value?.uninstall_requested) invoke('quit_app').catch(() => window.close())
        else mode.value = 'app'
    }

    function uninstall(removeData: boolean) {
        return invoke('uninstall_app', { removeData }).catch(error => { throw new Error(errorMessage(error)) })
    }

    function quit() {
        invoke('quit_app').catch(() => window.close())
    }

    return { info, mode, ready, install, launchInstalled, runPortable, openUninstall, cancelUninstall, uninstall, quit }
})
