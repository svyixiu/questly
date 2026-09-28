<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Game } from '@/types/types';
import { useSettings } from '@/composables/settings';
import { shuffle, useScheduler, type TimerMode, type TimerOrder } from '@/composables/scheduler';
import { useDiscordDetect } from '@/composables/discord-detect';
import { defaultExecutable, formatDuration } from '@/utils/executables';
import { vSmooth } from '@/directives/smooth-scroll';
import BaseModal from './BaseModal.vue';
import GameAvatar from './GameAvatar.vue';
import ToggleSwitch from './ToggleSwitch.vue';
import TypingInput from './TypingInput.vue';

const props = defineProps<{
    open: boolean;
    games: Game[];
    /** true when the targets are the checked games (vs. the whole library) */
    fromSelection: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

const { settings } = useSettings();
const scheduler = useScheduler();
const discord = useDiscordDetect();

const MAX_SECONDS = 24 * 3600;
// kept as text so typing (and the typing animation) behaves naturally
const minutesText = ref('0');
const secondsText = ref('0');
const minutes = computed(() => parseInt(minutesText.value, 10) || 0);
const seconds = computed(() => parseInt(secondsText.value, 10) || 0);

const digitsOnly = (v: string | undefined) => (v ?? '').replace(/\D/g, '').slice(0, 5);

/** ↑/↓ nudge the value, like a number field. */
function nudge(e: KeyboardEvent, field: 'm' | 's') {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? 1 : -1;
    const next = Math.max(0, total.value + dir * (field === 'm' ? 60 : 5));
    setTotal(Math.min(MAX_SECONDS, next));
}
const mode = ref<TimerMode>('parallel');
const order = ref<TimerOrder>('fixed');
const waitForDiscord = ref(true);
const shuffled = ref<Game[]>([]);

function setTotal(total: number) {
    minutesText.value = String(Math.floor(total / 60));
    secondsText.value = String(total % 60);
}

const launchable = computed(() => props.games.filter(g => defaultExecutable(g)));

watch(() => props.open, open => {
    if (!open) return;
    setTotal(settings.value.timerSeconds);
    mode.value = settings.value.timerMode;
    order.value = settings.value.timerOrder;
    waitForDiscord.value = settings.value.timerWaitForDiscord;
    shuffled.value = shuffle(launchable.value);
}, { immediate: true });

const presets = [30, 60, 5 * 60, 15 * 60, 30 * 60, 60 * 60];

const total = computed(() => minutes.value * 60 + seconds.value);

/** Typing 90 into seconds becomes 1:30 once the field loses focus. */
function normalize() {
    if (total.value > 0) setTotal(Math.min(MAX_SECONDS, total.value));
}

const skipped = computed(() => props.games.length - launchable.value.length);
const multi = computed(() => launchable.value.length > 1);
const valid = computed(() => total.value >= 1 && total.value <= MAX_SECONDS);
const sequential = computed(() => multi.value && mode.value === 'sequential');
const ordered = computed(() => sequential.value && order.value === 'random' ? shuffled.value : launchable.value);

const totalRun = computed(() => sequential.value ? total.value * launchable.value.length : total.value);

function start() {
    normalize();
    if (!valid.value || launchable.value.length === 0) return;
    scheduler.start(ordered.value, total.value, {
        mode: mode.value,
        order: order.value,
        waitForDiscord: waitForDiscord.value && discord.available.value,
    });
    emit('close');
}
</script>

<template>
    <BaseModal :open="open" eyebrow="Timed run" title="Play it, then stop it." width="35rem" @close="emit('close')"
        :subtitle="`Launch ${fromSelection ? 'the checked games' : 'your library'} and stop ${launchable.length === 1 ? 'it' : 'them'} when time's up.`">

        <!-- Duration -->
        <div class="eyebrow mb-2">{{ sequential ? 'Time per game' : 'Duration' }}</div>
        <div class="flex items-end gap-3">
            <label class="clock" :class="{ invalid: !valid }">
                <TypingInput :model-value="minutesText" @update:model-value="v => minutesText = digitsOnly(v)"
                    inputmode="numeric" aria-label="Minutes" class="clock-field"
                    @blur="normalize" @keydown.enter="start" @keydown="nudge($event, 'm')" />
                <span class="unit">min</span>
            </label>
            <span class="display text-3xl text-faint pb-3">:</span>
            <label class="clock" :class="{ invalid: !valid }">
                <TypingInput :model-value="secondsText" @update:model-value="v => secondsText = digitsOnly(v)"
                    inputmode="numeric" aria-label="Seconds" class="clock-field"
                    @blur="normalize" @keydown.enter="start" @keydown="nudge($event, 's')" />
                <span class="unit">sec</span>
            </label>
            <div class="flex flex-wrap gap-1.5 pb-1 ml-1">
                <button v-for="p in presets" :key="p" class="preset" :class="{ on: total === p }" @click="setTotal(p)">
                    {{ formatDuration(p).replace(' min', 'm').replace(' sec', 's').replace(' h', 'h') }}
                </button>
            </div>
        </div>

        <!-- Wait for Discord -->
        <div class="option mt-5">
            <div>
                <div class="text-sm font-semibold text-ink">Start the countdown when Discord detects the game</div>
                <div class="text-xs text-muted mt-0.5 leading-relaxed">
                    <template v-if="discord.available.value">
                        Watches {{ discord.clients.value.join(', ') }} and starts each countdown when it reports the game,
                        so the time matches quest progress. Gives up after {{ settings.detectTimeoutSec }} seconds.
                    </template>
                    <template v-else>Discord's log wasn't found on this PC, so countdowns start right away.</template>
                </div>
            </div>
            <ToggleSwitch v-model="waitForDiscord" :disabled="!discord.available.value" label="Wait for Discord" />
        </div>

        <!-- Mode + order -->
        <Transition name="rise">
            <div v-if="multi" class="mt-5">
                <div class="eyebrow mb-2">How to run {{ launchable.length }} games</div>
                <div class="seg">
                    <button :class="{ on: mode === 'parallel' }" @click="mode = 'parallel'">All at once</button>
                    <button :class="{ on: mode === 'sequential' }" @click="mode = 'sequential'">One after another</button>
                </div>

                <Transition name="rise">
                    <div v-if="mode === 'sequential'" class="mt-3">
                        <div class="flex items-center gap-2">
                            <div class="seg flex-1">
                                <button :class="{ on: order === 'fixed' }" @click="order = 'fixed'">Fixed order</button>
                                <button :class="{ on: order === 'random' }" @click="order = 'random'">Random order</button>
                            </div>
                            <Transition name="pop">
                                <button v-if="order === 'random'" class="icon-btn" data-tip="Shuffle again"
                                    @click="shuffled = shuffle(launchable)">
                                    <svg viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="2"
                                        stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
                                </button>
                            </Transition>
                        </div>
                        <div v-smooth class="mt-2 max-h-40 overflow-y-auto rounded-2xl bg-glass border border-line p-1.5">
                            <TransitionGroup name="list" tag="div" class="relative">
                                <div v-for="(g, i) in ordered" :key="g.uid" class="flex items-center gap-2.5 px-2 py-1 rounded-xl">
                                    <span class="w-4 text-right text-xs font-semibold text-faint tabular-nums">{{ i + 1 }}</span>
                                    <GameAvatar :game="g" :size="22" />
                                    <span class="text-[13px] text-ink-2 truncate">{{ g.name }}</span>
                                </div>
                            </TransitionGroup>
                        </div>
                    </div>
                </Transition>
            </div>
        </Transition>

        <div class="mt-5 flex items-center justify-between gap-3 text-xs text-muted">
            <span>
                Total <span class="text-ink font-semibold">{{ valid ? formatDuration(totalRun) : '—' }}</span>
                <template v-if="waitForDiscord && discord.available.value"> + detection time</template>
            </span>
            <span v-if="skipped > 0" class="text-warn">{{ skipped }} without an executable will be skipped</span>
        </div>

        <template #footer>
            <button class="btn btn-glass" @click="emit('close')">Cancel</button>
            <button class="btn btn-primary" :disabled="!valid || launchable.length === 0" @click="start">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2"
                    stroke-linecap="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></svg>
                Start timed run
            </button>
        </template>
    </BaseModal>
</template>

<style scoped>
.clock {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.4rem 0.6rem 0.35rem;
    border-radius: 16px;
    border: 1px solid var(--line-strong);
    transition: border-color 160ms ease;
}

.clock:focus-within {
    border-color: var(--ink);
}

.clock.invalid {
    border-color: var(--danger);
}

.clock-field {
    --ti-justify: center;
    width: 4.25rem;
    text-align: center;
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 2.4rem;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
}

.unit {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
}

.preset {
    height: 1.875rem;
    padding: 0 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--ink-2);
    transition: background-color 150ms ease, color 150ms ease, transform 200ms var(--ease-spring);
}

.preset:hover {
    background: var(--glass-3);
}

.preset:active {
    transform: scale(0.94);
}

.preset.on {
    background: var(--btn);
    border-color: var(--btn);
    color: var(--btn-ink);
}

.option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 1rem;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--glass);
}
</style>
