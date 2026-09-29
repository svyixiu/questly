<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import TypingInput from '@/components/TypingInput.vue';
import { useNow } from '@vueuse/core';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useInstaller } from '@/composables/installer';
import BaseModal from '@/components/BaseModal.vue';
import { hideWindow, setGameWindowsVisible, useSettings, type GuardSensitivity } from '@/composables/settings';
import { useToasts } from '@/composables/toasts';
import { useGameLibrary } from '@/composables/game-library';
import { useDiscordDetect } from '@/composables/discord-detect';
import { usePerformanceGuard } from '@/composables/performance-guard';
import { useStartup } from '@/composables/startup';
import { useBuddy, type BuddyPhase } from '@/composables/legit-buddy';
import { Pages, useGlobalState } from '@/composables/app-state';
import { ACCENTS, THEMES, presetAsCustom, snapshotAppearance, type ThemeId } from '@/theme/themes';
import { vSmooth } from '@/directives/smooth-scroll';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import ColorField from '@/components/ColorField.vue';
import RangeSlider from '@/components/RangeSlider.vue';
import NumberField from '@/components/NumberField.vue';
import LogoMark from '@/components/LogoMark.vue';
import ChangelogModal from '@/components/ChangelogModal.vue';
import { CHANGELOG, formatReleaseDate } from '@/data/changelog';
import { LINKS, openLink } from '@/data/legal';

const { settings, defaults } = useSettings();
const { toast } = useToasts();
const library = useGameLibrary();
const { libraryFile } = library;
const discord = useDiscordDetect();
const now = useNow({ interval: 5000 });
const { page } = useGlobalState();

const customAccent = computed(() => settings.value.accent !== null && !ACCENTS.includes(settings.value.accent));

function onCustomAccent(e: Event) {
    settings.value.accent = (e.target as HTMLInputElement).value;
}

// ----- custom theme -----
const PRESETS = THEMES.filter(t => t.id !== 'custom' && t.id !== 'system');

function pickTheme(id: ThemeId) {
    // the first time: start from exactly what's on screen now
    if (id === 'custom' && !settings.value.customTheme) settings.value.customTheme = snapshotAppearance();
    settings.value.theme = id;
}

function customSwatch(fallback: [string, string, string]): [string, string, string] {
    const c = settings.value.customTheme;
    return c ? [c.bg, c.paper, c.accent] : fallback;
}

function startCustomFrom(id: ThemeId) {
    settings.value.customTheme = presetAsCustom(id, null);
    toast('info', `Custom theme reset to ${THEMES.find(t => t.id === id)?.name}`);
}

const percent = (v: number) => `${Math.round(v * 100)}%`;
const pixels = (v: number) => `${Math.round(v)} px`;

// ----- Performance Guard -----
const guard = usePerformanceGuard();
let stopLive: (() => void) | null = null;
// live CPU/memory numbers only while Settings is on screen
watch(() => page.value === Pages.SETTINGS, visible => {
    stopLive?.();
    stopLive = visible ? guard.watchLive() : null;
}, { immediate: true });
onUnmounted(() => stopLive?.());

const confirmGuardOff = ref(false);
const guardEnabled = computed({
    get: () => settings.value.perfGuard.enabled,
    set: on => {
        if (on) settings.value.perfGuard.enabled = true;
        else confirmGuardOff.value = true;
    },
});
function turnGuardOff() {
    settings.value.perfGuard.enabled = false;
    confirmGuardOff.value = false;
    toast('warning', 'Performance Guard is off', 'Timed runs now keep every game open, however busy your PC gets.');
}
const SENSITIVITY: { id: GuardSensitivity; label: string; desc: string }[] = [
    { id: 'relaxed', label: 'Relaxed', desc: 'Steps in only when the PC is nearly maxed out (CPU 92%, memory 93%).' },
    { id: 'balanced', label: 'Balanced', desc: 'Steps in under heavy load (CPU 85%, memory 88%) or stutter.' },
    { id: 'strict', label: 'Strict', desc: 'Keeps plenty of headroom (CPU 75%, memory 82%). Best for older PCs.' },
];
const sensitivityDesc = computed(() => SENSITIVITY.find(s => s.id === settings.value.perfGuard.sensitivity)?.desc);
const meterClass = (v: number, limit: number) => v >= limit ? 'bg-danger' : v >= limit - 15 ? 'bg-warn' : 'bg-accent';

// ----- Launch on startup + Legitimate Buddy -----
const startup = useStartup();
const buddy = useBuddy();

const startupEnabled = computed({
    get: () => startup.enabled.value,
    set: async on => {
        try {
            await startup.set(on);
            if (!on && settings.value.buddy.enabled) toast('info', 'Legitimate Buddy was turned off too', 'It needs Launch on startup.');
            else toast('success', on ? 'Questly starts with Windows' : "Questly won't start with Windows",
                on ? 'It opens quietly in the tray when you sign in.' : undefined);
        } catch (e) {
            toast('error', "Couldn't change Launch on startup", String(e));
        }
    },
});

const buddyPrompt = ref(false);
const buddyEnabled = computed({
    get: () => settings.value.buddy.enabled,
    set: on => {
        if (on && !startup.enabled.value) buddyPrompt.value = true;
        else settings.value.buddy.enabled = on;
    },
});
async function enableBuddyWithStartup() {
    buddyPrompt.value = false;
    try {
        await startup.set(true);
        settings.value.buddy.enabled = true;
        toast('success', 'Legitimate Buddy is on', 'Questly now also starts with Windows, quietly in the tray.');
    } catch (e) {
        toast('error', "Couldn't turn on Launch on startup", String(e));
    }
}

const DAYS = [
    { v: 1, short: 'M', name: 'Monday' }, { v: 2, short: 'T', name: 'Tuesday' }, { v: 3, short: 'W', name: 'Wednesday' },
    { v: 4, short: 'T', name: 'Thursday' }, { v: 5, short: 'F', name: 'Friday' }, { v: 6, short: 'S', name: 'Saturday' },
    { v: 0, short: 'S', name: 'Sunday' },
];
function toggleDay(v: number) {
    const days = settings.value.buddy.days;
    settings.value.buddy.days = days.includes(v) ? days.filter(d => d !== v) : [...days, v];
}

const PHASE_LABEL: Record<BuddyPhase, string> = {
    off: 'Off',
    blocked: 'Paused',
    'outside-hours': 'Resting',
    'waiting-idle': 'Waiting',
    'waiting-discord': 'Waiting for Discord',
    'starting-discord': 'Opening Discord',
    playing: 'Playing',
    'done-today': 'Done for today',
};
const idleText = computed(() => {
    const s = buddy.idleSeconds.value;
    return s < 60 ? 'active now' : `idle ${Math.floor(s / 60)} min`;
});

function hideNow() {
    toast('info', 'Hiding to the tray…', 'Click the tray icon to bring the window back.', 1500);
    setTimeout(hideWindow, 900);
}

async function gameWindows(visible: boolean) {
    const count = await setGameWindowsVisible(visible);
    toast('info', count ? `${visible ? 'Showing' : 'Hid'} ${count} game window${count === 1 ? '' : 's'}` : 'No game windows are open');
}

/** Applies to new launches; running game windows follow right away too. */
function setWindowMode(mode: 'hidden' | 'parked' | 'visible') {
    settings.value.gameWindowMode = mode;
    if (mode === 'visible') setGameWindowsVisible(true);
    if (mode === 'hidden') setGameWindowsVisible(false);
}

function resetAppearance() {
    // the custom colors stay saved for next time
    settings.value.theme = defaults.theme;
    settings.value.accent = defaults.accent;
    settings.value.reduceMotion = defaults.reduceMotion;
}

const lastSeen = computed(() => {
    const at = discord.lastEventAt.value;
    if (!at) return 'nothing yet';
    const s = Math.round((now.value.getTime() - at) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(at).toLocaleTimeString();
});

// ----- import / export -----
type Entries = ReturnType<typeof library.parseLibraryText>;
const pendingImport = ref<{ name: string; entries: Entries; total: number; fresh: number; duplicates: number } | null>(null);

async function exportLibrary() {
    try {
        const path = await save({
            title: 'Export your Questly library',
            defaultPath: `questly-library-${new Date().toISOString().slice(0, 10)}.json`,
            filters: [{ name: 'Questly library', extensions: ['json'] }],
        });
        if (!path) return;
        await invoke('write_text_file', { path, content: library.exportText() });
        toast('success', 'Library exported', path);
    } catch (e) {
        toast('error', "Couldn't export", String(e));
    }
}

async function importLibrary() {
    try {
        const path = await open({
            title: 'Import a Questly library',
            multiple: false,
            directory: false,
            filters: [{ name: 'Questly library', extensions: ['json'] }],
        });
        if (!path || Array.isArray(path)) return;
        const text = await invoke<string>('read_text_file', { path });
        const entries = library.parseLibraryText(text);
        pendingImport.value = { name: path.split(/[\\/]/).pop() ?? path, entries, ...library.previewImport(entries) };
    } catch (e) {
        toast('error', "Couldn't import that file", e instanceof Error ? e.message : String(e), 7000);
    }
}

function confirmImport(importMode: 'replace' | 'merge') {
    if (!pendingImport.value) return;
    library.importEntries(pendingImport.value.entries, importMode);
    pendingImport.value = null;
}

// ----- detection timeout (typed as text, committed on blur/Enter) -----
const timeoutText = ref(String(settings.value.detectTimeoutSec));
watch(timeoutText, v => {
    const clean = v.replace(/\D/g, '').slice(0, 3);
    if (clean !== v) timeoutText.value = clean;
});
watch(() => settings.value.detectTimeoutSec, v => { timeoutText.value = String(v); });
function commitTimeout() {
    const n = parseInt(timeoutText.value, 10);
    settings.value.detectTimeoutSec = Number.isFinite(n) ? Math.min(900, Math.max(10, n)) : settings.value.detectTimeoutSec;
    timeoutText.value = String(settings.value.detectTimeoutSec);
}

// ----- installation -----
const installer = useInstaller();
const installInfo = installer.info;

// ----- about -----
const changelogOpen = ref(false);
const appVersion = computed(() => installInfo.value?.version ?? CHANGELOG[0].version);
const updatedOn = computed(() => formatReleaseDate((CHANGELOG.find(r => r.version === appVersion.value) ?? CHANGELOG[0]).date));
const agreedOn = computed(() => settings.value.termsAcceptedAt
    ? new Date(settings.value.termsAcceptedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null);
</script>

<template>
    <div v-smooth class="h-full overflow-y-auto px-4 pb-4">
        <div class="max-w-[1000px] mx-auto pt-5">
            <div class="px-2 pb-4 flex items-end justify-between gap-4">
                <div>
                    <div class="eyebrow">Settings</div>
                    <h1 class="display text-[34px] leading-[38px] text-ink mt-1">Make it yours.</h1>
                </div>
                <button class="version-pill" data-tip="See what changed" data-tip-pos="bottom" @click="changelogOpen = true">
                    <span class="font-semibold text-ink">Questly {{ appVersion }}</span>
                    <span class="text-muted">· updated {{ updatedOn }}</span>
                    <span class="version-cta">Changelog</span>
                </button>
            </div>

            <div class="grid grid-cols-2 gap-4 items-start">
                <!-- ===== Appearance ===== -->
                <section class="glass p-6">
                    <div class="flex items-center justify-between mb-4">
                        <h2 class="card-title">Appearance</h2>
                        <button class="btn btn-link btn-sm" @click="resetAppearance">Reset</button>
                    </div>

                    <div class="eyebrow mb-3">Theme</div>
                    <div class="grid grid-cols-4 gap-3 mb-6">
                        <button v-for="t in THEMES" :key="t.id" class="theme" :class="{ on: settings.theme === t.id }"
                            @click="pickTheme(t.id)">
                            <!-- canvas, a cream card, and the accent dot -->
                            <span class="orb" :style="{ background: (t.id === 'custom' ? customSwatch(t.swatch) : t.swatch)[0] }">
                                <span class="orb-card" :style="{ background: (t.id === 'custom' ? customSwatch(t.swatch) : t.swatch)[1] }"></span>
                                <span class="orb-dot" :style="{ background: (t.id === 'custom' ? customSwatch(t.swatch) : t.swatch)[2] }"></span>
                                <svg v-if="t.id === 'custom'" viewBox="0 0 24 24" class="orb-pen" fill="none" stroke="currentColor"
                                    stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
                            </span>
                            <span class="text-[11px] font-semibold text-ink-2 mt-1.5 truncate w-full text-center">{{ t.name }}</span>
                        </button>
                    </div>

                    <template v-if="settings.theme === 'custom'">
                        <div class="rounded-2xl bg-accent-soft px-3.5 py-2.5 text-xs text-ink-2 mb-6 leading-relaxed">
                            You're using your own colors. Edit each one in <span class="font-semibold text-ink">Custom theme</span> below.
                        </div>
                    </template>
                    <template v-else>
                    <div class="eyebrow mb-1">Accent</div>
                    <p class="text-xs text-muted mb-3">
                        Picking one re-tints the whole app to match: background glow, surfaces, text, cards and the app icon.
                        Colors are adjusted automatically so everything stays readable.
                    </p>
                    <div class="flex flex-wrap items-center gap-2.5 mb-6">
                        <button class="accent-default" :class="{ on: settings.accent === null }" @click="settings.accent = null">Theme</button>
                        <button v-for="c in ACCENTS" :key="c" class="accent" :class="{ on: settings.accent === c }"
                            :style="{ background: c }" :aria-label="`Accent ${c}`" @click="settings.accent = c"></button>
                        <label class="accent custom" data-tip="Custom color" :class="{ on: customAccent }"
                            :style="customAccent ? { background: settings.accent! } : {}">
                            <svg v-if="!customAccent" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                                stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
                            <input type="color" class="sr-only" :value="settings.accent ?? '#8b7bff'" @input="onCustomAccent" />
                        </label>
                    </div>
                    </template>

                    <div class="row">
                        <div>
                            <div class="row-title">Reduce motion</div>
                            <div class="row-desc">Turns off animations, smooth scrolling and typing effects.</div>
                        </div>
                        <ToggleSwitch v-model="settings.reduceMotion" label="Reduce motion" />
                    </div>
                </section>

                <!-- ===== Window & tray ===== -->
                <section class="glass p-6">
                    <h2 class="card-title mb-1">Window &amp; tray</h2>
                    <p class="text-xs text-muted mb-2 leading-relaxed">
                        Hidden, the app keeps running in the system tray. Click its tray icon to bring it back, or right-click
                        it for Stop all games, Hide/Show game windows and Quit.
                    </p>
                    <div class="row">
                        <div>
                            <div class="row-title">Auto hide</div>
                            <div class="row-desc">After launching games or starting a timer, hide this app <em>and</em> the game
                                windows. Games then start without a window or tray icon.</div>
                        </div>
                        <ToggleSwitch v-model="settings.autoHide" label="Auto hide" />
                    </div>
                    <div class="row">
                        <div>
                            <div class="row-title">Close to tray</div>
                            <div class="row-desc">The red close button hides the app instead of quitting.</div>
                        </div>
                        <ToggleSwitch v-model="settings.closeToTray" label="Close to tray" />
                    </div>
                    <div class="row">
                        <div>
                            <div class="row-title">Always on top</div>
                            <div class="row-desc">Keep Questly above every other window. The pin in the title bar does the same.</div>
                        </div>
                        <ToggleSwitch v-model="settings.alwaysOnTop" label="Always on top" />
                    </div>
                    <div class="row">
                        <div>
                            <div class="row-title">Come back when a timer finishes</div>
                            <div class="row-desc">Show the window again once a timed run is done.</div>
                        </div>
                        <ToggleSwitch v-model="settings.showOnTimerEnd" label="Show when a timed run finishes" />
                    </div>
                    <div class="row">
                        <div class="min-w-0 flex-1">
                            <div class="row-title">Game windows</div>
                            <div class="row-desc">
                                Each game can show a small square card with its icon, a timer, and Close / Close &amp; delete.
                                Drag it anywhere. It never takes focus.
                                <template v-if="settings.autoHide"><br><span class="text-warn">Auto hide is on, so they're hidden.</span></template>
                            </div>
                            <div class="seg mt-2.5 max-w-[22rem]" :class="{ 'opacity-50 pointer-events-none': settings.autoHide }">
                                <button :class="{ on: settings.gameWindowMode === 'hidden' }" @click="setWindowMode('hidden')">Hidden</button>
                                <button :class="{ on: settings.gameWindowMode === 'parked' }" @click="setWindowMode('parked')">Off-screen</button>
                                <button :class="{ on: settings.gameWindowMode === 'visible' }" @click="setWindowMode('visible')">On screen</button>
                            </div>
                        </div>
                        <div class="flex flex-col gap-1.5 shrink-0 self-start">
                            <button class="btn btn-glass btn-sm" data-tip="Bring running games' windows into view" @click="gameWindows(true)">Show all</button>
                            <button class="btn btn-glass btn-sm" data-tip="Hide running games' windows" @click="gameWindows(false)">Hide all</button>
                        </div>
                    </div>
                    <div class="row">
                        <div>
                            <div class="row-title">Hide now</div>
                            <div class="row-desc">Send the app to the tray right away.</div>
                        </div>
                        <button class="btn btn-glass btn-sm shrink-0" @click="hideNow">Hide</button>
                    </div>
                </section>

                <!-- ===== Custom theme ===== -->
                <Transition name="rise">
                    <section v-if="settings.theme === 'custom' && settings.customTheme" class="glass p-6 col-span-2">
                        <div class="flex items-start justify-between gap-6 mb-1">
                            <div>
                                <h2 class="card-title">Custom theme</h2>
                                <p class="text-xs text-muted mt-1 leading-relaxed max-w-[34rem]">
                                    One color for each part of the app. Changes show up everywhere right away, including the
                                    game windows you launch next and the app icon.
                                </p>
                            </div>
                            <div class="shrink-0 text-right">
                                <div class="eyebrow mb-1.5">Start from</div>
                                <div class="flex flex-wrap justify-end gap-1.5 max-w-[22rem]">
                                    <button v-for="p in PRESETS" :key="p.id" class="preset" @click="startCustomFrom(p.id)">
                                        <span class="preset-dot" :style="{ background: p.swatch[0], boxShadow: `inset 0 0 0 3px ${p.swatch[2]}` }"></span>
                                        {{ p.name }}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-3 gap-5 mt-4">
                            <div>
                                <div class="eyebrow mb-2">Background</div>
                                <div class="grid gap-2">
                                    <ColorField v-model="settings.customTheme.bg" label="Window" />
                                    <div class="grid grid-cols-2 gap-2">
                                        <ColorField v-for="i in 4" :key="i" v-model="settings.customTheme.glow[i - 1]" :label="`Glow ${i}`" />
                                    </div>
                                </div>
                                <div class="grid gap-3.5 mt-4">
                                    <RangeSlider v-model="settings.customTheme.glowOpacity" label="Glow strength" :min="0" :max="0.8"
                                        :step="0.01" :format="percent" />
                                    <RangeSlider v-model="settings.customTheme.glowBlur" label="Glow softness" :min="0" :max="180"
                                        :format="pixels" />
                                </div>
                            </div>

                            <div>
                                <div class="eyebrow mb-2">Cards &amp; text</div>
                                <div class="grid grid-cols-2 gap-2">
                                    <ColorField v-model="settings.customTheme.surface" label="Cards" />
                                    <ColorField v-model="settings.customTheme.line" label="Borders" />
                                    <ColorField v-model="settings.customTheme.text" label="Text" />
                                    <ColorField v-model="settings.customTheme.muted" label="Secondary text" />
                                </div>
                                <div class="grid gap-3.5 mt-4">
                                    <RangeSlider v-model="settings.customTheme.glassOpacity" label="Card solidity" :min="0.3" :max="1"
                                        :step="0.01" :format="percent" />
                                    <RangeSlider v-model="settings.customTheme.glassBlur" label="Blur behind cards" :min="0" :max="48"
                                        :format="pixels" />
                                </div>
                            </div>

                            <div>
                                <div class="eyebrow mb-2">Highlights</div>
                                <div class="grid grid-cols-2 gap-2">
                                    <ColorField v-model="settings.customTheme.accent" label="Accent" class="col-span-2" />
                                    <ColorField v-model="settings.customTheme.button" label="Buttons" />
                                    <ColorField v-model="settings.customTheme.buttonText" label="Button text" />
                                    <ColorField v-model="settings.customTheme.paper" label="Feature cards" />
                                    <ColorField v-model="settings.customTheme.paperText" label="Their text" />
                                </div>
                                <!-- a tiny sample, so the less visible colors can be judged too -->
                                <div class="paper mt-3 p-3 flex items-center gap-2.5 !rounded-2xl">
                                    <span class="live-dot"></span>
                                    <span class="text-[12.5px] font-semibold flex-1 truncate">Feature card</span>
                                    <span class="btn btn-primary btn-sm !h-7 !px-3 !text-xs pointer-events-none">Play</span>
                                </div>
                            </div>
                        </div>
                    </section>
                </Transition>

                <!-- ===== Startup & Legitimate Buddy ===== -->
                <section class="glass p-6 col-span-2">
                    <div class="grid grid-cols-[1fr_1.35fr] gap-8">
                        <div>
                            <h2 class="card-title mb-1">Startup</h2>
                            <div class="row !border-t-0 !pt-1">
                                <div>
                                    <div class="row-title">Launch on startup</div>
                                    <div class="row-desc">Start Questly quietly in the tray when you sign in to Windows: no splash,
                                        no window. Legitimate Buddy needs this.</div>
                                </div>
                                <ToggleSwitch v-model="startupEnabled" :disabled="!startup.available.value || startup.busy.value"
                                    label="Launch on startup" />
                            </div>
                            <p v-if="startup.enabled.value && installInfo && !installInfo.running_installed && !installInfo.dev"
                                class="text-[11.5px] text-warn leading-relaxed">
                                This copy isn't installed, so Windows will start it from where it is now. Install Questly to keep
                                that from breaking if the file moves.
                            </p>

                            <!-- Buddy status -->
                            <div class="mt-4 rounded-2xl bg-glass border border-line p-4">
                                <div class="flex items-center gap-2">
                                    <span class="eyebrow">Buddy status</span>
                                    <span class="ml-auto" :class="buddy.phase.value === 'playing' ? 'tag' : 'chip'">
                                        <span v-if="buddy.phase.value === 'playing'" class="live-dot !bg-on-accent"></span>
                                        <span v-else-if="buddy.phase.value.startsWith('waiting') || buddy.phase.value === 'starting-discord'" class="wait-dot !w-1.5 !h-1.5"></span>
                                        {{ PHASE_LABEL[buddy.phase.value] }}
                                    </span>
                                </div>
                                <p class="text-[13px] text-ink-2 mt-2 leading-snug min-h-[1.2rem]">
                                    {{ buddy.detail.value || (settings.buddy.enabled ? 'Getting ready…' : 'Turn it on to let it play for you while you\'re away.') }}
                                </p>
                                <div class="grid grid-cols-2 gap-2 mt-3 text-xs">
                                    <div class="rounded-xl border border-line px-3 py-2">
                                        <div class="text-muted">Today</div>
                                        <div class="text-ink font-semibold tabular-nums mt-0.5">
                                            {{ buddy.today.value.played }} of {{ buddy.today.value.target || '–' }} games
                                        </div>
                                    </div>
                                    <div class="rounded-xl border border-line px-3 py-2">
                                        <div class="text-muted">You</div>
                                        <div class="text-ink font-semibold mt-0.5">{{ idleText }}</div>
                                    </div>
                                </div>
                                <div v-if="buddy.lastRun.value && !buddy.session.value" class="text-[11.5px] text-muted mt-2.5 leading-snug">
                                    Last session: {{ buddy.lastRun.value.games.join(', ') || 'no games' }} ({{ buddy.lastRun.value.reason }}).
                                </div>
                                <div class="flex gap-2 mt-3">
                                    <button v-if="buddy.session.value" class="btn btn-danger btn-sm" @click="buddy.abort('stopped by you')">Stop session</button>
                                    <button class="btn btn-glass btn-sm" :disabled="!settings.buddy.enabled" @click="buddy.tick()">Check now</button>
                                </div>
                            </div>
                        </div>

                        <div>
                            <div class="flex items-center gap-3 mb-1">
                                <h2 class="card-title">Legitimate Buddy</h2>
                                <ToggleSwitch v-model="buddyEnabled" class="ml-auto" label="Legitimate Buddy" />
                            </div>
                            <p class="text-xs text-muted leading-relaxed mb-1">
                                While you're away from the PC, Buddy opens a few games from your library now and then, the way
                                you'd play them yourself, and closes them again. It stops the moment you're back.
                            </p>

                            <div class="buddy-grid" :class="{ off: !settings.buddy.enabled }">
                                <div class="row">
                                    <div class="row-title">Start after I've been away</div>
                                    <NumberField v-model="settings.buddy.idleMinutes" :min="1" :max="600" suffix="min" label="Idle minutes" />
                                </div>
                                <div class="row">
                                    <div class="row-title">Games per day</div>
                                    <div class="flex items-center gap-1.5">
                                        <NumberField v-model="settings.buddy.gamesPerDayMin" :min="1" :max="50" :chars="2" label="Fewest games per day" />
                                        <span class="text-xs text-muted">to</span>
                                        <NumberField v-model="settings.buddy.gamesPerDayMax" :min="1" :max="50" :chars="2" label="Most games per day" />
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="row-title">Each game stays open</div>
                                    <div class="flex items-center gap-1.5">
                                        <NumberField v-model="settings.buddy.sessionMinMinutes" :min="1" :max="600" label="Shortest time per game" />
                                        <span class="text-xs text-muted">to</span>
                                        <NumberField v-model="settings.buddy.sessionMaxMinutes" :min="1" :max="600" suffix="min" label="Longest time per game" />
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="row-title">At most at the same time</div>
                                    <NumberField v-model="settings.buddy.maxConcurrent" :min="1" :max="10" :chars="2" suffix="games" label="Most games at once" />
                                </div>
                                <div class="row">
                                    <div>
                                        <div class="row-title">Which games</div>
                                        <div class="row-desc">Random picks, favoring ones not played yet today.</div>
                                    </div>
                                    <div class="seg shrink-0">
                                        <button :class="{ on: settings.buddy.source === 'library' }" @click="settings.buddy.source = 'library'">Any in my library</button>
                                        <button :class="{ on: settings.buddy.source === 'installed' }" data-tip="Games Questly has already set up on this PC"
                                            @click="settings.buddy.source = 'installed'">Only set up ones</button>
                                    </div>
                                </div>
                                <div class="row">
                                    <div>
                                        <div class="row-title">When</div>
                                        <div class="row-desc">Can run past midnight (22 to 3). The same hour twice means all day.</div>
                                    </div>
                                    <div class="flex flex-col items-end gap-2">
                                        <div class="flex items-center gap-1.5">
                                            <NumberField v-model="settings.buddy.fromHour" :min="0" :max="24" :chars="2" suffix=":00" label="From hour" />
                                            <span class="text-xs text-muted">to</span>
                                            <NumberField v-model="settings.buddy.toHour" :min="0" :max="24" :chars="2" suffix=":00" label="Until hour" />
                                        </div>
                                        <div class="flex gap-1">
                                            <button v-for="d in DAYS" :key="d.v" class="day" :class="{ on: settings.buddy.days.includes(d.v) }"
                                                :aria-label="d.name" :aria-pressed="settings.buddy.days.includes(d.v)" :data-tip="d.name"
                                                @click="toggleDay(d.v)">{{ d.short }}</button>
                                        </div>
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="row-title">Stop as soon as I'm back</div>
                                    <ToggleSwitch v-model="settings.buddy.stopWhenBack" label="Stop as soon as I'm back" />
                                </div>
                                <div class="row">
                                    <div>
                                        <div class="row-title">Only while Discord is running</div>
                                        <div class="row-desc">Games only count for quests while Discord sees them.</div>
                                    </div>
                                    <ToggleSwitch v-model="settings.buddy.requireDiscord" label="Only while Discord is running" />
                                </div>
                                <div class="row">
                                    <div>
                                        <div class="row-title">Open Discord if it's closed</div>
                                        <div class="row-desc">Starts your installed Discord before playing.</div>
                                    </div>
                                    <ToggleSwitch v-model="settings.buddy.openDiscord" label="Open Discord if it's closed" />
                                </div>
                                <div class="row" :class="{ 'opacity-50': !settings.buddy.openDiscord }">
                                    <div>
                                        <div class="row-title">Close Discord afterwards</div>
                                        <div class="row-desc">Only if Buddy opened it, and never while you're using the PC.</div>
                                    </div>
                                    <ToggleSwitch v-model="settings.buddy.closeDiscordAfter" :disabled="!settings.buddy.openDiscord"
                                        label="Close Discord afterwards" />
                                </div>
                                <div class="row">
                                    <div>
                                        <div class="row-title">Count time from Discord's detection</div>
                                        <div class="row-desc">Each game's time starts once Discord reports it.</div>
                                    </div>
                                    <ToggleSwitch v-model="settings.buddy.waitForDiscord" label="Count time from Discord's detection" />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- ===== Performance Guard ===== -->
                <section class="glass p-6">
                    <div class="flex items-center gap-3 mb-1">
                        <h2 class="card-title">Performance Guard</h2>
                        <ToggleSwitch v-model="guardEnabled" class="ml-auto" label="Performance Guard" />
                    </div>
                    <p class="text-xs text-muted leading-relaxed mb-3">
                        During timed runs it keeps an eye on your PC. If things get heavy or start to stutter, it closes a
                        few games for a while and brings them back, with their time left, once the PC calms down.
                    </p>
                    <div class="grid grid-cols-2 gap-2 mb-1">
                        <div class="rounded-xl border border-line px-3 py-2.5">
                            <div class="flex justify-between text-xs"><span class="text-muted">CPU</span>
                                <span class="text-ink font-semibold tabular-nums">{{ guard.load.value ? Math.round(guard.load.value.cpu) + '%' : '–' }}</span></div>
                            <div class="meter"><span :class="meterClass(guard.load.value?.cpu ?? 0, guard.thresholds.value.cpu)"
                                :style="{ width: `${guard.load.value?.cpu ?? 0}%` }"></span></div>
                        </div>
                        <div class="rounded-xl border border-line px-3 py-2.5">
                            <div class="flex justify-between text-xs"><span class="text-muted">Memory</span>
                                <span class="text-ink font-semibold tabular-nums">{{ guard.load.value ? Math.round(guard.load.value.memory) + '%' : '–' }}</span></div>
                            <div class="meter"><span :class="meterClass(guard.load.value?.memory ?? 0, guard.thresholds.value.memory)"
                                :style="{ width: `${guard.load.value?.memory ?? 0}%` }"></span></div>
                        </div>
                    </div>
                    <div class="text-[11.5px] text-muted mb-2 min-h-[1rem]">
                        <template v-if="!guard.available.value">Live numbers are only available in the desktop app.</template>
                        <template v-else-if="guard.limit.value !== null">Right now: at most {{ guard.limit.value }} game{{ guard.limit.value === 1 ? '' : 's' }} open at once.</template>
                        <template v-else-if="guard.lastAction.value">Last: {{ guard.lastAction.value.text }}.</template>
                        <template v-else-if="guard.load.value">{{ guard.load.value.cores }} CPU threads. No limits needed so far.</template>
                    </div>
                    <div class="row" :class="{ 'opacity-50 pointer-events-none': !settings.perfGuard.enabled }">
                        <div class="min-w-0 flex-1">
                            <div class="row-title">Sensitivity</div>
                            <div class="row-desc">{{ sensitivityDesc }}</div>
                            <div class="seg mt-2.5 max-w-[20rem]">
                                <button v-for="s in SENSITIVITY" :key="s.id" :class="{ on: settings.perfGuard.sensitivity === s.id }"
                                    @click="settings.perfGuard.sensitivity = s.id">{{ s.label }}</button>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- ===== Discord detection ===== -->
                <section class="glass p-6">
                    <div class="flex items-center gap-2 mb-1">
                        <h2 class="card-title">Discord detection</h2>
                        <span class="chip ml-auto" :class="discord.available.value ? '!text-ok' : ''">
                            <span class="w-1.5 h-1.5 rounded-full" :class="discord.available.value ? 'bg-ok' : 'bg-faint'"></span>
                            {{ discord.available.value ? 'Connected' : 'Not found' }}
                        </span>
                    </div>
                    <p class="text-xs text-muted mb-2 leading-relaxed">
                        Discord writes a line to its own log whenever it notices a game start. The app watches for that line to
                        know a game has really been picked up. Only that line is read, and nothing leaves your PC.
                    </p>
                    <div v-if="discord.available.value" class="rounded-2xl bg-glass border border-line px-3.5 py-2.5 text-xs space-y-1 mb-1">
                        <div class="flex justify-between gap-3"><span class="text-muted">Watching</span><span class="text-ink-2 font-medium">{{ discord.clients.value.join(', ') }}</span></div>
                        <div class="flex justify-between gap-3"><span class="text-muted">Last detection event</span><span class="text-ink-2 font-medium">{{ lastSeen }}</span></div>
                        <div v-if="discord.primaryGame.value" class="flex justify-between gap-3"><span class="text-muted">Discord's main game</span><span class="text-ink-2 font-medium truncate">{{ discord.primaryGame.value }}</span></div>
                    </div>
                    <div class="row">
                        <div>
                            <div class="row-title">Timers wait for detection</div>
                            <div class="row-desc">Default for new timed runs: start each countdown only once Discord reports the game.</div>
                        </div>
                        <ToggleSwitch v-model="settings.timerWaitForDiscord" :disabled="!discord.available.value" label="Timers wait for detection" />
                    </div>
                    <div class="row">
                        <div>
                            <div class="row-title">Give up waiting after</div>
                            <div class="row-desc">If Discord stays silent this long, the countdown starts anyway.</div>
                        </div>
                        <label class="field flex items-center gap-1 !h-9 !px-3 shrink-0">
                            <TypingInput v-model="timeoutText" inputmode="numeric" aria-label="Seconds"
                                class="w-12 text-right text-sm font-semibold tabular-nums [--ti-justify:flex-end]"
                                @blur="commitTimeout" @keydown.enter="commitTimeout" />
                            <span class="text-xs text-muted">sec</span>
                        </label>
                    </div>
                </section>

                <!-- ===== Library file ===== -->
                <section class="glass p-6">
                    <h2 class="card-title mb-1">Library file</h2>
                    <p class="text-xs text-muted mb-3 leading-relaxed">
                        Your games are saved in <span class="font-mono text-ink-2">library.json</span> in
                        <span class="font-mono text-ink-2">%APPDATA%\Questly</span>. You can edit it with the app open or
                        closed. To add a game, an entry only needs
                        <span class="font-mono text-ink-2">{ "id": "…" }</span> or <span class="font-mono text-ink-2">{ "name": "…" }</span>.
                        Edits are picked up when you switch back to the app.
                    </p>
                    <template v-if="libraryFile.available">
                        <div class="rounded-2xl bg-glass border border-line px-3.5 py-2.5 font-mono text-[11.5px] text-ink-2 break-all selectable mb-3">
                            {{ libraryFile.path }}
                        </div>
                        <Transition name="rise">
                            <div v-if="libraryFile.error" class="rounded-2xl bg-danger-soft px-3.5 py-2.5 text-xs text-danger mb-3">
                                <span class="font-semibold">The file has an error:</span> {{ libraryFile.error }}.
                                Your list is kept as it was and the file won't be overwritten until it's fixed.
                            </div>
                        </Transition>
                        <div class="flex flex-wrap gap-2">
                            <button class="btn btn-primary btn-sm" @click="exportLibrary">Export…</button>
                            <button class="btn btn-glass btn-sm" @click="importLibrary">Import…</button>
                            <button class="btn btn-glass btn-sm" @click="library.revealFile()">Show in folder</button>
                            <button class="btn btn-link btn-sm" @click="library.syncFromFile({ force: true, announce: true })">Reload</button>
                        </div>
                    </template>
                    <div v-else class="text-xs text-muted">Only available in the desktop app.</div>
                </section>

                <!-- ===== Installation ===== -->
                <section v-if="installInfo" class="glass p-6">
                    <div class="flex flex-col gap-4">
                        <div class="min-w-0">
                            <h2 class="card-title mb-1">Installation</h2>
                            <p class="text-xs text-muted leading-relaxed">
                                <template v-if="installInfo.running_installed">
                                    Installed in <span class="font-mono text-ink-2 selectable">{{ installInfo.install_dir }}</span> ·
                                    version {{ installInfo.version }}. To share Questly, send friends the same .exe you installed it from;
                                    it installs itself.
                                </template>
                                <template v-else-if="installInfo.dev">Development build: installing is turned off.</template>
                                <template v-else>
                                    Running without installing, from <span class="font-mono text-ink-2 selectable">{{ installInfo.current_exe }}</span>.
                                </template>
                            </p>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button v-if="!installInfo.running_installed && !installInfo.dev" class="btn btn-primary btn-sm"
                                @click="installer.mode.value = 'installer'">Install…</button>
                            <button v-if="installInfo.installed_exists" class="btn btn-danger btn-sm" @click="installer.openUninstall()">Uninstall…</button>
                        </div>
                    </div>
                </section>

                <!-- ===== About ===== -->
                <section class="glass p-6 col-span-2">
                    <div class="flex items-center gap-5">
                        <LogoMark class="w-14 h-14 shrink-0" />
                        <div class="min-w-0">
                            <div class="eyebrow">About</div>
                            <h2 class="display text-[30px] leading-[32px] text-ink mt-0.5">Questly</h2>
                            <p class="text-sm text-muted mt-1">
                                Version <span class="text-ink-2 font-semibold">{{ appVersion }}</span> · updated {{ updatedOn }}
                            </p>
                        </div>
                        <div class="ml-auto flex flex-wrap justify-end gap-2">
                            <button class="btn btn-primary btn-sm" @click="changelogOpen = true">Changelog</button>
                            <button class="btn btn-glass btn-sm" @click="openLink(LINKS.website)">Website</button>
                            <button class="btn btn-glass btn-sm" @click="openLink(LINKS.source)">Source code</button>
                        </div>
                    </div>

                    <div class="row mt-5">
                        <div class="min-w-0">
                            <div class="row-title">Terms &amp; notice</div>
                            <div class="row-desc">
                                <template v-if="agreedOn">You agreed to the Terms of Service and Terms of Use on {{ agreedOn }}.</template>
                                <template v-else>You accepted the risk notice.</template>
                                Read them again any time:
                            </div>
                            <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px]">
                                <button class="doc-link" @click="openLink(LINKS.terms)">Terms of Service</button>
                                <button class="doc-link" @click="openLink(LINKS.termsOfUse)">Terms of Use</button>
                                <button class="doc-link" @click="openLink(LINKS.privacy)">Privacy Policy</button>
                                <button class="doc-link" @click="openLink(LINKS.licenses)">Licenses</button>
                                <button class="doc-link" @click="openLink(LINKS.credits)">Credits</button>
                            </div>
                        </div>
                        <button class="btn btn-glass btn-sm shrink-0" @click="settings.riskAcceptedAt = null">Review the notice</button>
                    </div>
                    <p class="text-xs text-muted leading-relaxed pt-3 border-t border-line">
                        Built on <button class="doc-link" @click="openLink(LINKS.original)">Discord Quest Completer</button> by
                        Mark Terence Tiglao, under the MIT License. Questly isn't affiliated with or endorsed by Discord, and you use
                        it at your own risk.
                    </p>
                </section>
            </div>

            <ChangelogModal :open="changelogOpen" :current-version="appVersion" @close="changelogOpen = false" />

            <BaseModal :open="!!pendingImport" eyebrow="Import" title="How should it be added?" width="32rem" @close="pendingImport = null">
                <template v-if="pendingImport">
                    <p class="text-[15px] text-ink-2 leading-snug">
                        <span class="font-semibold text-ink">{{ pendingImport.name }}</span> has
                        {{ pendingImport.total }} game{{ pendingImport.total === 1 ? '' : 's' }}:
                        {{ pendingImport.fresh }} new, {{ pendingImport.duplicates }} already in your library.
                    </p>
                    <div class="mt-4 space-y-2">
                        <button class="choice" @click="confirmImport('merge')">
                            <span class="text-[15px] font-semibold text-ink">Keep mine and add the import</span>
                            <span class="text-sm text-muted">Adds the {{ pendingImport.fresh }} new game{{ pendingImport.fresh === 1 ? '' : 's' }}; skips duplicates.</span>
                        </button>
                        <button class="choice" @click="confirmImport('replace')">
                            <span class="text-[15px] font-semibold text-ink">Delete mine and use the import</span>
                            <span class="text-sm text-muted">Your library becomes exactly the file's {{ pendingImport.total }} games.</span>
                        </button>
                    </div>
                </template>
                <template #footer>
                    <button class="btn btn-glass" @click="pendingImport = null">Cancel</button>
                </template>
            </BaseModal>

            <BaseModal :open="confirmGuardOff" eyebrow="Performance Guard" title="Turn it off?" width="30rem"
                @close="confirmGuardOff = false">
                <p class="text-[15px] text-ink-2 leading-snug">
                    Without it, a timed run keeps every game open at once, however hard your PC is working. With many
                    games on a slower PC, everything can start to stutter or even freeze.
                </p>
                <p class="text-sm text-muted mt-3 leading-snug">You can turn it back on at any time.</p>
                <template #footer>
                    <button class="btn btn-danger" @click="turnGuardOff">Turn off anyway</button>
                    <button class="btn btn-primary" @click="confirmGuardOff = false">Keep it on</button>
                </template>
            </BaseModal>

            <BaseModal :open="buddyPrompt" eyebrow="Legitimate Buddy" title="It needs Launch on startup." width="30rem"
                @close="buddyPrompt = false">
                <p class="text-[15px] text-ink-2 leading-snug">
                    Buddy plays while you're away, so Questly has to be running in the background. Turning Buddy on also
                    makes Questly start quietly in the tray when you sign in to Windows.
                </p>
                <template #footer>
                    <button class="btn btn-glass" @click="buddyPrompt = false">Cancel</button>
                    <button class="btn btn-primary" @click="enableBuddyWithStartup">Turn both on</button>
                </template>
            </BaseModal>

        </div>
    </div>
</template>

<style scoped>
.choice {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    text-align: left;
    padding: 0.85rem 1rem;
    border-radius: 16px;
    border: 1px solid var(--line-strong);
    transition: background-color 150ms ease, border-color 150ms ease, transform 220ms var(--ease-spring);
}

.choice:hover {
    background: var(--glass-3);
    border-color: var(--ink-2);
}

.choice:active {
    transform: scale(0.98);
}

.card-title {
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--ink);
    letter-spacing: -0.02em;
}

.theme {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
}

.orb {
    position: relative;
    display: block;
    width: 56px;
    height: 56px;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    transition: transform 350ms var(--ease-spring), box-shadow 200ms ease;
}

.orb-card {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: -6px;
    height: 30px;
    border-radius: 8px;
}

.orb-dot {
    position: absolute;
    top: 9px;
    right: 9px;
    width: 10px;
    height: 10px;
    border-radius: 999px;
}

.theme:hover .orb {
    transform: translateY(-2px);
}

.theme.on .orb {
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--ink);
}

.accent {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    color: var(--ink-2);
    transition: transform 300ms var(--ease-spring), box-shadow 150ms ease;
}

.accent:hover {
    transform: scale(1.12);
}

.accent.on {
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--ink);
}

.accent.custom {
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
}

.accent.custom.on {
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--ink);
}

.accent-default {
    height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--glass-2);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-2);
    transition: box-shadow 150ms ease, background 150ms ease;
}

.accent-default.on {
    background: var(--glass-3);
    color: var(--ink);
    box-shadow: 0 0 0 2px var(--accent);
}

.row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.25rem;
    padding: 0.8rem 0;
    border-top: 1px solid var(--line);
}

.version-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 5px 0 14px;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    font-size: 0.8rem;
    white-space: nowrap;
    transition: border-color 150ms ease, background-color 150ms ease, transform 220ms var(--ease-spring);
}

.version-pill:hover {
    border-color: var(--ink-2);
    background: var(--glass-2);
}

.version-pill:active {
    transform: scale(0.97);
}

.version-cta {
    margin-left: 4px;
    height: 24px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: var(--btn);
    color: var(--btn-ink);
    font-weight: 700;
    font-size: 0.74rem;
}

.doc-link {
    color: var(--ink-2);
    font-weight: 600;
    text-decoration: underline;
    text-decoration-color: var(--line-strong);
    text-underline-offset: 3px;
    transition: color 150ms ease, text-decoration-color 150ms ease;
}

.doc-link:hover {
    color: var(--ink);
    text-decoration-color: var(--accent);
}

.orb-pen {
    position: absolute;
    left: 9px;
    top: 9px;
    width: 14px;
    height: 14px;
    color: var(--ink);
    mix-blend-mode: difference;
}

.preset {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 1.75rem;
    padding: 0 0.6rem 0 0.35rem;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-2);
    transition: background-color 150ms ease, color 150ms ease, transform 220ms var(--ease-spring);
}

.preset:hover {
    background: var(--glass-2);
    color: var(--ink);
}

.preset:active {
    transform: scale(0.95);
}

.preset-dot {
    width: 16px;
    height: 16px;
    border-radius: 999px;
}

.buddy-grid {
    transition: opacity 250ms ease;
}

.buddy-grid.off {
    opacity: 0.5;
}

.buddy-grid .row {
    padding: 0.6rem 0;
}

.day {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--ink-2);
    transition: background-color 180ms ease, color 180ms ease, border-color 180ms ease, transform 220ms var(--ease-spring);
}

.day:hover {
    color: var(--ink);
}

.day:active {
    transform: scale(0.9);
}

.day.on {
    background: var(--btn);
    border-color: var(--btn);
    color: var(--btn-ink);
}

.meter {
    height: 5px;
    margin-top: 0.45rem;
    border-radius: 999px;
    background: var(--glass-3);
    overflow: hidden;
}

.meter > span {
    display: block;
    height: 100%;
    border-radius: inherit;
    transition: width 900ms var(--ease-quint), background-color 300ms ease;
}

.row-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink);
}

.row-desc {
    font-size: 0.75rem;
    color: var(--muted);
    margin-top: 0.15rem;
    line-height: 1.1rem;
}
</style>
