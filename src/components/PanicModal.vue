<script setup lang="ts">
import { computed } from 'vue';
import BaseModal from './BaseModal.vue';
import { usePanic } from '@/composables/panic';

const { report } = usePanic();

const steps = computed(() => {
    const r = report.value;
    if (!r) return [];
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    return [
        { text: r.stoppedGames ? `Stopped ${plural(r.stoppedGames, 'game')}` : 'No games were running', done: true },
        ...(r.strays ? [{ text: `Closed ${plural(r.strays, 'leftover game window')}`, done: true }] : []),
        { text: r.timerCancelled ? 'Cancelled the timed run' : 'No timed run was active', done: true },
        { text: r.buddyStopped ? "Ended Legitimate Buddy's session" : 'Legitimate Buddy was idle', done: true },
        { text: r.rpcCleared ? 'Cleared the Discord RPC activity' : 'No RPC activity to clear', done: true },
    ];
});
</script>

<template>
    <BaseModal :open="!!report" eyebrow="Panic Abort" title="System recovered." width="30rem" @close="report = null">
        <template v-if="report">
            <p class="text-[15px] text-ink-2 leading-snug">
                Everything Questly had going is stopped. It took {{ report.ms }} ms.
            </p>
            <ul class="mt-4 space-y-1.5">
                <li v-for="(step, i) in steps" :key="step.text" class="step" :style="{ animationDelay: `${120 + i * 90}ms` }">
                    <span class="check" :style="{ animationDelay: `${160 + i * 90}ms` }">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
                            stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                    </span>
                    <span class="text-sm text-ink">{{ step.text }}</span>
                </li>
            </ul>
        </template>
        <template #footer>
            <button class="btn btn-primary" @click="report = null">Done</button>
        </template>
    </BaseModal>
</template>

<style scoped>
.step {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.5rem 0.75rem;
    border-radius: 14px;
    background: var(--glass);
    animation: step-in 520ms var(--ease-quint) both;
}

.check {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--ok);
    color: var(--paper);
    animation: check-pop 420ms var(--ease-spring) both;
}

.check svg {
    width: 13px;
    height: 13px;
    stroke-dasharray: 16;
    stroke-dashoffset: 16;
    animation: draw 360ms var(--ease-quint) forwards;
    animation-delay: inherit;
}

@keyframes step-in {
    from {
        opacity: 0;
        transform: translateY(8px);
    }
}

@keyframes check-pop {
    from {
        transform: scale(0.4);
        opacity: 0;
    }
}

@keyframes draw {
    to {
        stroke-dashoffset: 0;
    }
}
</style>
