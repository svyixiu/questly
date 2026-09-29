import { openUrl } from '@tauri-apps/plugin-opener'

export const SITE_URL = 'https://questly-plum.vercel.app'
export const REPO_URL = 'https://github.com/svyixiu/questly'
export const ORIGINAL_URL = 'https://github.com/markterence/discord-quest-completer'

export const LINKS = {
    website: SITE_URL,
    terms: `${SITE_URL}/terms`,
    termsOfUse: `${SITE_URL}/terms-of-use`,
    privacy: `${SITE_URL}/privacy`,
    licenses: `${SITE_URL}/licenses`,
    credits: `${SITE_URL}/credits`,
    source: REPO_URL,
    releases: `${REPO_URL}/releases`,
    original: ORIGINAL_URL,
} as const

/**
 * The Terms of Service and Terms of Use the app asks you to agree to, by the
 * date they were last updated. Change it when the Terms change, and everyone
 * is asked to agree again.
 */
export const TERMS_VERSION = '2026-09-29'

/** Has the user accepted the risk notice and the current Terms? */
export function hasAgreed(s: { riskAcceptedAt: number | null; termsVersion: string | null }) {
    return s.riskAcceptedAt !== null && s.termsVersion === TERMS_VERSION
}

/** Opens a page in the default browser (a new tab outside the desktop app). */
export function openLink(url: string) {
    openUrl(url).catch(() => window.open(url, '_blank', 'noopener'))
}
