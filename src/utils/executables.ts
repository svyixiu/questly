import { getCurrentOS } from '@/constants/constants';
import type { Game, GameExecutable } from '@/types/types';

const ILLEGAL_PATH_CHARS = ['>', '<', ':', '"', '|', '?', '*'];

export function isValidPath(name: string) {
    return !ILLEGAL_PATH_CHARS.some(char => name.includes(char));
}

export function validExecutables(game: Game) {
    return game.executables.filter(executable => isValidPath(executable.name));
}

/**
 * Executables for the current platform. Falls back to every valid executable
 * when Discord has none registered for this OS.
 */
export function platformExecutables(game: Game) {
    const valid = validExecutables(game);
    const currentPlatform = getCurrentOS();
    const platformMatches = valid.filter(executable => executable.os === currentPlatform);
    return platformMatches.length > 0 ? platformMatches : valid;
}

export function usesCrossPlatformFallback(game: Game) {
    const valid = validExecutables(game);
    const currentPlatform = getCurrentOS();
    return valid.length > 0 && !valid.some(executable => executable.os === currentPlatform);
}

/** The executable used for one-click Play and batch launches. */
export function defaultExecutable(game: Game): GameExecutable | undefined {
    const candidates = platformExecutables(game);
    if (game.selected_exe) {
        const chosen = candidates.find(exe => exe.name === game.selected_exe);
        if (chosen) return chosen;
    }
    // Prefer the actual game over its launcher
    return candidates.find(exe => !exe.is_launcher) ?? candidates[0];
}

export function splitExecutableName(executable: GameExecutable) {
    const allSections = executable.name.split(/\\|\//);
    const last = allSections[allSections.length - 1];
    // strip the file extension from the last section, if it has one
    const name = last?.split('.').slice(0, -1).join('.') || last;
    return [...allSections.slice(0, -1), name];
}

export function getFilename(executable: GameExecutable) {
    return executable.name.split(/\\|\//).pop();
}

/** Folder part of the executable name, joined with the platform separator. */
export function getExecutablePath(executable: GameExecutable, sep: string) {
    return executable.name.split(/\\|\//).slice(0, -1).join(sep);
}

export function isGameRunning(game: Game) {
    return game.executables.some(exe => exe.is_running);
}

export function runningExecutable(game: Game) {
    return game.executables.find(exe => exe.is_running);
}

export function gameIconUrl(game: Pick<Game, 'id' | 'icon_hash'>, size = 64) {
    if (!game.icon_hash) return null;
    return `https://cdn.discordapp.com/app-icons/${game.id}/${game.icon_hash}.png?size=${size}`;
}

/** Human-friendly duration from seconds, e.g. "45 sec", "15 min", "1 h 2 min 5 sec". */
export function formatDuration(totalSeconds: number) {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts: string[] = [];
    if (h) parts.push(`${h} h`);
    if (m) parts.push(`${m} min`);
    if (sec || parts.length === 0) parts.push(`${sec} sec`);
    return parts.join(' ');
}

/** Formats a duration in ms as m:ss or h:mm:ss. */
export function formatElapsed(ms: number) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
