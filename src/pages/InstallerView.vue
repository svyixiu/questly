<script setup lang="ts">
import { computed, ref } from 'vue';
import { useInstaller } from '@/composables/installer';
import { recordAgreement, useSettings } from '@/composables/settings';
import AnimatedCheckbox from '@/components/AnimatedCheckbox.vue';
import RiskTerms from '@/components/RiskTerms.vue';
import LogoMark from '@/components/LogoMark.vue';

const installer = useInstaller();
const { info } = installer;
const { settings } = useSettings();

type Step = 'welcome' | 'rules' | 'installing' | 'done' | 'error';
const step = ref<Step>('welcome');
const desktop = ref(true);
const startMenu = ref(true);
const risk = ref(false);
const terms = ref(false);
const error = ref('');
const launching = ref(false);

const stepIndex = computed(() => ({ welcome: 0, rules: 1, installing: 2, done: 2, error: 2 })[step.value]);

async function runInstall() {
    recordAgreement(settings);
    step.value = 'installing';
    // give the progress screen a moment so the change isn't jarring
    const [result] = await Promise.all([installer.install(desktop.value, startMenu.value), new Promise(r => setTimeout(r, 900))]);
    if (result.ok) step.value = 'done';
    else {
        error.value = result.error;
        step.value = 'error';
    }
}

async function launch() {
    launching.value = true;
    try {
        await installer.launchInstalled();
    } catch (e) {
        error.value = (e as Error).message;
        step.value = 'error';
        launching.value = false;
    }
}

const features = [
    ['Play without the game', 'Discord sees you playing any of 24,000+ detectable games.'],
    ['Timers that wait for Discord', 'Countdowns start once Discord actually notices the game.'],
    ['Run lists your way', 'All at once, or one after another in fixed or random order.'],
    ['Stays out of the way', 'Games open off-screen, never steal focus, and can hide completely.'],
];
</script>

<template>
    <div class="h-full grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 px-4 pt-3 pb-4">
        <!-- What you're installing -->
        <section class="glass flex flex-col justify-between p-8 overflow-hidden">
            <div>
                <LogoMark class="w-12 h-12 mb-6" />
                <div class="eyebrow mb-2">Questly {{ info?.version ? `v${info.version}` : '' }}</div>
                <h1 class="display text-[44px] leading-[44px] text-ink">
                    Quests, done quietly.
                </h1>
            </div>
            <ul class="space-y-4">
                <li v-for="[title, text] in features" :key="title" class="flex gap-3">
                    <span class="mt-1.5 w-2 h-2 rounded-full bg-accent shrink-0"></span>
                    <div>
                        <div class="text-[15px] font-semibold text-ink">{{ title }}</div>
                        <div class="text-sm text-muted leading-snug">{{ text }}</div>
                    </div>
                </li>
            </ul>
        </section>

        <!-- Steps -->
        <section class="paper flex flex-col overflow-hidden">
            <span class="absolute top-[18px] right-[18px] w-3 h-3 rounded-full bg-ink" aria-hidden="true"></span>
            <div class="flex items-center gap-2 px-8 pt-7">
                <template v-for="(label, i) in ['Install', 'Rules', 'Done']" :key="label">
                    <span v-if="i > 0" class="h-px w-6 bg-line-strong"></span>
                    <span class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] transition-colors"
                        :class="i <= stepIndex ? 'text-ink' : 'text-faint'">
                        <span class="w-5 h-5 rounded-full grid place-items-center text-[11px] transition-colors"
                            :class="i < stepIndex ? 'bg-ink text-[var(--paper)]' : i === stepIndex ? 'border border-ink' : 'border border-line-strong'">
                            <svg v-if="i < stepIndex" viewBox="0 0 16 16" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.4"
                                stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                            <template v-else>{{ i + 1 }}</template>
                        </span>
                        {{ label }}
                    </span>
                </template>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto px-8 pt-6 pb-2">
                <Transition name="rise" mode="out-in">
                    <!-- 1. Install -->
                    <div v-if="step === 'welcome'" key="welcome">
                        <h2 class="display text-[32px] leading-[34px] text-ink">Install Questly.</h2>
                        <p class="text-[15px] text-muted mt-2 leading-snug">
                            Installs just for you, with no admin rights needed. Your game library is kept in
                            <span class="font-mono text-[13px] text-ink-2">%APPDATA%\Questly</span>.
                        </p>

                        <div v-if="info?.installed_exists" class="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-line-strong px-4 py-3">
                            <span class="text-sm text-ink">Questly is already installed on this PC.</span>
                            <button class="btn btn-glass btn-sm" :disabled="launching" @click="launch">Open it</button>
                        </div>

                        <div class="mt-5 space-y-2">
                            <label class="option" @click.prevent="desktop = !desktop">
                                <AnimatedCheckbox :checked="desktop" label="Desktop shortcut" @toggle="desktop = !desktop" />
                                <span class="text-sm text-ink">Add a desktop shortcut</span>
                            </label>
                            <label class="option" @click.prevent="startMenu = !startMenu">
                                <AnimatedCheckbox :checked="startMenu" label="Start menu shortcut" @toggle="startMenu = !startMenu" />
                                <span class="text-sm text-ink">Add to the Start menu</span>
                            </label>
                        </div>
                        <div class="mt-4 text-xs text-muted">
                            Installs to <span class="font-mono text-ink-2 selectable">{{ info?.install_dir ?? '%LOCALAPPDATA%\\Programs\\Questly' }}</span>
                        </div>
                    </div>

                    <!-- 2. Rules -->
                    <div v-else-if="step === 'rules'" key="rules">
                        <div class="eyebrow mb-1.5">Rules &amp; policy</div>
                        <h2 class="display text-[28px] leading-[30px] text-ink mb-3">Your account, your responsibility.</h2>
                        <RiskTerms v-model:risk="risk" v-model:terms="terms" />
                    </div>

                    <!-- Installing -->
                    <div v-else-if="step === 'installing'" key="installing" class="h-full flex flex-col justify-center">
                        <div class="flex items-center gap-3 text-ink">
                            <span class="spinner !w-5 !h-5"></span>
                            <h2 class="display text-[28px] leading-[30px]">Installing…</h2>
                        </div>
                        <p class="text-[15px] text-muted mt-2">Copying Questly, adding shortcuts and registering it in Apps &amp; features.</p>
                    </div>

                    <!-- Done -->
                    <div v-else-if="step === 'done'" key="done" class="h-full flex flex-col justify-center">
                        <div class="eyebrow mb-2">All set</div>
                        <h2 class="display text-[40px] leading-[42px] text-ink">Questly is installed.</h2>
                        <p class="text-[15px] text-muted mt-3 leading-snug max-w-md">
                            Open it any time from {{ desktop && startMenu ? 'your desktop or the Start menu' : desktop ? 'your desktop' : startMenu ? 'the Start menu' : 'its install folder' }}.
                            To remove it later, use Settings → Uninstall, or Windows' Apps &amp; features.
                        </p>
                    </div>

                    <!-- Error -->
                    <div v-else key="error" class="h-full flex flex-col justify-center">
                        <div class="eyebrow mb-2">Something went wrong</div>
                        <h2 class="display text-[32px] leading-[34px] text-ink">Couldn't finish.</h2>
                        <p class="text-sm text-danger mt-3 selectable break-words">{{ error }}</p>
                    </div>
                </Transition>
            </div>

            <div class="flex items-center gap-2 px-8 pb-7 pt-4">
                <template v-if="step === 'welcome'">
                    <button class="btn btn-link" @click="installer.runPortable()">Run without installing</button>
                    <button class="btn btn-primary ml-auto min-w-[8rem]" @click="step = 'rules'">Install</button>
                </template>
                <template v-else-if="step === 'rules'">
                    <button class="btn btn-glass" @click="step = 'welcome'">Back</button>
                    <button class="btn btn-primary ml-auto" :disabled="!risk || !terms" @click="runInstall">Accept &amp; install</button>
                </template>
                <template v-else-if="step === 'done'">
                    <button class="btn btn-link" @click="installer.quit()">Close</button>
                    <button class="btn btn-primary ml-auto min-w-[10rem]" :disabled="launching" @click="launch">
                        <span v-if="launching" class="spinner"></span>
                        Launch Questly
                    </button>
                </template>
                <template v-else-if="step === 'error'">
                    <button class="btn btn-glass" @click="step = 'welcome'">Back</button>
                    <button class="btn btn-primary ml-auto" @click="runInstall">Try again</button>
                </template>
            </div>
        </section>
    </div>
</template>

<style scoped>
.option {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 16px;
    border: 1px solid var(--line-strong);
    cursor: pointer;
    transition: background-color 150ms ease;
}

.option:hover {
    background: var(--glass-2);
}
</style>
