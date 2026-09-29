<script setup lang="ts">
import { computed } from 'vue';
import { formatBytes, parseReleaseNotes, useUpdater } from '@/composables/updater';
import { vSmooth } from '@/directives/smooth-scroll';
import BaseModal from './BaseModal.vue';

/**
 * A newer Questly: what's in it, and whether to download it. While it downloads
 * this shows the progress; closing the dialog lets it carry on in the background.
 */
const updater = useUpdater();
const { state, info, error, downloaded, total, speed } = updater;

const sections = computed(() => parseReleaseNotes(info.value?.notes ?? ''));
const percent = computed(() => total.value > 0 ? Math.min(100, (downloaded.value / total.value) * 100) : 0);
const secondsLeft = computed(() => speed.value > 1 ? Math.ceil((total.value - downloaded.value) / speed.value) : null);
const eta = computed(() => {
    const s = secondsLeft.value;
    if (s === null) return '';
    return s >= 60 ? `about ${Math.ceil(s / 60)} min left` : `about ${Math.max(1, s)} s left`;
});
const busy = computed(() => state.value === 'downloading' || state.value === 'installing');
const open = computed(() => updater.dialogOpen.value && !!info.value?.available);
</script>

<template>
    <BaseModal :open="open" eyebrow="Update" width="32rem" :persistent="state === 'installing'"
        :title="state === 'installing' ? 'Restarting to update…' : `Questly ${info?.latest} is here.`"
        :subtitle="state === 'installing'
            ? `Questly closes and opens again as version ${info?.latest}.`
            : `You have ${info?.current}. The download is ${formatBytes(info?.size ?? 0)}; Questly restarts by itself once it's done.`"
        @close="updater.dialogOpen.value = false">

        <!-- progress -->
        <Transition name="rise">
            <div v-if="busy" class="mb-4">
                <div class="h-2 rounded-full bg-[var(--paper-fill-2)] overflow-hidden">
                    <div class="h-full rounded-full bg-ink transition-[width] duration-200 ease-linear"
                        :style="{ width: `${state === 'installing' ? 100 : percent}%` }"></div>
                </div>
                <div class="flex justify-between gap-3 mt-2 text-xs text-muted tabular-nums">
                    <span v-if="state === 'installing'">Downloaded and checked</span>
                    <span v-else>{{ formatBytes(downloaded) }} of {{ formatBytes(total) }} · {{ Math.floor(percent) }}%</span>
                    <span v-if="state === 'downloading'">{{ speed > 0 ? `${formatBytes(speed)}/s` : 'Starting…' }}{{ eta ? ` · ${eta}` : '' }}</span>
                </div>
            </div>
        </Transition>

        <p v-if="state === 'error' && error" class="mb-4 text-sm text-danger leading-snug selectable">{{ error }}</p>

        <!-- what's new -->
        <div v-if="sections.length && state !== 'installing'" v-smooth class="max-h-64 overflow-y-auto rounded-2xl border border-line p-4">
            <div v-for="section in sections" :key="section.title" class="mb-3 last:mb-0">
                <div class="eyebrow mb-1.5">{{ section.title }}</div>
                <ul class="space-y-1.5">
                    <li v-for="(item, i) in section.items" :key="i" class="flex gap-2 text-[13px] text-ink-2 leading-snug">
                        <span class="mt-[7px] w-1.5 h-1.5 rounded-full bg-ink shrink-0"></span>
                        <span>{{ item }}</span>
                    </li>
                </ul>
            </div>
        </div>

        <template #footer>
            <template v-if="state === 'downloading'">
                <span class="mr-auto text-xs text-muted">You can close this; the download carries on.</span>
                <button class="btn btn-glass" @click="updater.cancel()">Cancel download</button>
            </template>
            <template v-else-if="state === 'installing'">
                <span class="spinner"></span>
            </template>
            <template v-else>
                <button class="btn btn-glass" @click="updater.dialogOpen.value = false">Not now</button>
                <button class="btn btn-primary" @click="state === 'error' ? updater.retry() : updater.download()">
                    {{ state === 'error' ? 'Try again' : 'Download update' }}
                </button>
            </template>
        </template>
    </BaseModal>
</template>
