<script setup lang="ts">
import { computed, ref, TransitionGroup, watch } from 'vue';
import type { Game } from '@/types/types';
import { useSettings } from '@/composables/settings';
import { AT_ONCE_CHOICES, shuffle, useScheduler, type TimerMode, type TimerOrder } from '@/composables/scheduler';
import { useDiscordDetect } from '@/composables/discord-detect';
import { measureCapacity, usePerformanceGuard, type Capacity } from '@/composables/performance-guard';
import { defaultExecutable, formatDuration } from '@/utils/executables';
import { vSmooth } from '@/directives/smooth-scroll';
import BaseModal from './BaseModal.vue';
import GameAvatar from './GameAvatar.vue';
import NumberField from './NumberField.vue';
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
const guard = usePerformanceGuard();

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
const atOnce = ref(1);
/** "Custom" picked: any number of games at a time, typed in */
const customAtOnce = ref(false);
const waitForDiscord = ref(true);
const shuffled = ref<Game[]>([]);
const capacity = ref<Capacity | null>(null);
let measuring: Promise<void> = Promise.resolve();
/** asking whether to go ahead with more at a time than the PC handles comfortably */
const confirmHeavy = ref(false);

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
    atOnce.value = settings.value.timerAtOnce ?? 1;
    customAtOnce.value = !(AT_ONCE_CHOICES as readonly number[]).includes(atOnce.value);
    waitForDiscord.value = settings.value.timerWaitForDiscord;
    shuffled.value = shuffle(launchable.value);
    confirmHeavy.value = false;
    // how many at a time this PC handles comfortably, measured fresh each time
    capacity.value = null;
    measuring = measureCapacity().then(c => { capacity.value = c; });
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

/** "At a time" choices that make sense for this many games (1 is always there). */
const atOnceChoices = computed(() => AT_ONCE_CHOICES.filter(n => n === 1 || n < launchable.value.length));
/** the count actually used: a remembered 10 becomes 3 for 4 games */
const slots = computed(() => Math.max(1, Math.min(atOnce.value, launchable.value.length)));
const canCustomize = computed(() => launchable.value.length > 2);

function pickAtOnce(n: number) {
    customAtOnce.value = false;
    atOnce.value = n;
}

function pickCustom() {
    customAtOnce.value = true;
}

/** more at a time than this PC handles comfortably (only once it's been measured) */
const tooMany = computed(() => sequential.value && !!capacity.value && slots.value > capacity.value.recommended);
const capacityReason = computed(() => {
    const c = capacity.value;
    if (!c) return '';
    const parts = [`${c.cores} processor threads`];
    if (c.freeMb > 0) parts.push(`${(c.freeMb / 1024).toFixed(1)} GB of free memory`);
    parts.push(`the CPU at ${Math.round(c.cpu)}% right now`);
    return parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(' and ');
});

// The queue preview shows the first games only: thousands of rows would make
// the dialog slow to open and to shuffle, and nobody reads past the top.
const PREVIEW = 50;
const preview = computed(() => ordered.value.slice(0, PREVIEW));
const notShown = computed(() => ordered.value.length - preview.value.length);
// a new order (fixed/random, shuffle) redraws a long queue's preview in one piece
const reshuffles = ref(0);
const previewKey = computed(() => `${sequential.value && order.value === 'random' ? 'random' : 'fixed'}-${reshuffles.value}`);

function reshuffle() {
    shuffled.value = shuffle(launchable.value);
    reshuffles.value++;
}

// several at a time: rounds of `slots` games, each taking the time per game
const totalRun = computed(() => sequential.value ? total.value * Math.ceil(launchable.value.length / slots.value) : total.value);

async function start() {
    normalize();
    if (!valid.value || launchable.value.length === 0) return;
    // a quick Start right after opening waits the half second the measurement takes
    await measuring;
    if (tooMany.value) {
        confirmHeavy.value = true;
        return;
    }
    run();
}

/** from the warning: go ahead as chosen, or with the comfortable number */
function startWith(n?: number) {
    if (n !== undefined) pickAtOnce(n);
    confirmHeavy.value = false;
    run();
}

function run() {
    scheduler.start(ordered.value, total.value, {
        mode: mode.value,
        order: order.value,
        atOnce: slots.value,
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
                <div class="eyebrow mb-2">How to run {{ launchable.length.toLocaleString() }} games</div>
                <div class="seg">
                    <button :class="{ on: mode === 'parallel' }" @click="mode = 'parallel'">All at once</button>
                    <button :class="{ on: mode === 'sequential' }" @click="mode = 'sequential'">One after another</button>
                </div>
                <Transition name="rise">
                    <p v-if="mode === 'parallel' && launchable.length > 25" class="mt-2 text-xs text-warn leading-snug">
                        {{ launchable.length.toLocaleString() }} games at the same time can slow your PC down. One after
                        another with {{ capacity ? `${capacity.recommended} at a time` : 'a few at a time' }} gets through them steadily.
                    </p>
                </Transition>

                <Transition name="rise">
                    <div v-if="mode === 'sequential'" class="mt-3">
                        <div class="flex items-center gap-2">
                            <div class="seg flex-1">
                                <button :class="{ on: order === 'fixed' }" @click="order = 'fixed'">Fixed order</button>
                                <button :class="{ on: order === 'random' }" @click="order = 'random'">Random order</button>
                            </div>
                            <Transition name="pop">
                                <button v-if="order === 'random'" class="icon-btn" data-tip="Shuffle again"
                                    @click="reshuffle">
                                    <svg viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="2"
                                        stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
                                </button>
                            </Transition>
                        </div>
                        <div class="mt-3 flex items-center justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-sm font-semibold text-ink">At a time</div>
                                <div class="text-xs text-muted mt-0.5 leading-snug">
                                    <template v-if="slots === 1">One game plays, then the next one starts.</template>
                                    <template v-else>{{ slots }} play together; when one's done, the next in line takes its place.</template>
                                </div>
                            </div>
                            <div class="seg shrink-0" role="radiogroup" aria-label="Games at a time">
                                <button v-for="n in atOnceChoices" :key="n" role="radio" :aria-checked="!customAtOnce && slots === n"
                                    class="tabular-nums" :class="{ on: !customAtOnce && slots === n }" @click="pickAtOnce(n)">{{ n }}</button>
                                <button v-if="canCustomize" role="radio" :aria-checked="customAtOnce" :class="{ on: customAtOnce }"
                                    @click="pickCustom">Custom</button>
                            </div>
                        </div>
                        <Transition name="rise">
                            <div v-if="customAtOnce && canCustomize" class="mt-2 flex items-center justify-end gap-2.5">
                                <span class="text-xs text-muted">Games at a time</span>
                                <NumberField v-model="atOnce" :min="1" :max="launchable.length" :chars="4" label="Games at a time" />
                            </div>
                        </Transition>
                        <p v-if="capacity" class="mt-2 text-xs leading-snug text-right" :class="tooMany ? 'text-warn' : 'text-muted'">
                            <template v-if="tooMany">More than this PC handles comfortably. {{ capacity.recommended }} at a time is recommended.</template>
                            <template v-else>This PC handles up to {{ capacity.recommended }} at a time comfortably.</template>
                        </p>
                        <div v-smooth class="mt-3 max-h-40 overflow-y-auto rounded-2xl bg-glass border border-line p-1.5">
                            <!-- the whole queue fits: games glide to their new places; a longer
                                 queue swaps its first rows in one fade (they're mostly new games) -->
                            <component :is="notShown > 0 ? 'div' : TransitionGroup" :key="notShown > 0 ? previewKey : 'all'"
                                v-bind="notShown > 0 ? { class: 'relative queue-swap' } : { name: 'list', tag: 'div', class: 'relative' }">
                                <div v-for="(g, i) in preview" :key="g.uid" class="flex items-center gap-2.5 px-2 py-1 rounded-xl">
                                    <span class="w-5 text-right text-xs font-semibold tabular-nums"
                                        :class="i < slots ? 'text-ink' : 'text-faint'">{{ i + 1 }}</span>
                                    <GameAvatar :game="g" :size="22" />
                                    <span class="text-[13px] text-ink-2 truncate">{{ g.name }}</span>
                                    <span v-if="i < slots && slots > 1" class="ml-auto shrink-0 text-[11px] font-semibold text-muted">starts first</span>
                                </div>
                            </component>
                            <div v-if="notShown > 0" class="px-2 py-1.5 text-xs text-muted">
                                and {{ notShown.toLocaleString() }} more after these
                            </div>
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

    <!-- more at a time than the PC handles comfortably: go ahead, or take the suggestion -->
    <BaseModal :open="open && confirmHeavy && !!capacity" eyebrow="Timed run" width="30rem" @close="confirmHeavy = false"
        :title="`${slots} at a time is a lot for this PC.`">
        <p class="text-[15px] text-muted leading-snug">
            Questly suggests <span class="text-ink font-semibold">{{ capacity?.recommended }} at a time</span> here,
            going by {{ capacityReason }}. More games at once can make your PC and Discord sluggish.
        </p>
        <p v-if="guard.enabled.value" class="text-xs text-muted mt-3 leading-snug">
            Performance Guard still closes a few games for a while if your PC starts to struggle.
        </p>
        <template #footer>
            <button class="btn btn-glass" @click="startWith()">Continue with {{ slots }}</button>
            <button class="btn btn-primary" @click="startWith(capacity!.recommended)">Use {{ capacity?.recommended }} at a time</button>
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

.queue-swap {
    animation: queue-in 320ms ease both;
}

@keyframes queue-in {
    from {
        opacity: 0;
        transform: translateY(6px);
    }
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
