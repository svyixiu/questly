<script setup lang="ts">
import BaseModal from './BaseModal.vue';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const groups: { title: string; items: { keys: string[][]; label: string }[] }[] = [
    {
        title: 'Search',
        items: [
            { keys: [['Ctrl', 'K'], ['/']], label: 'Open Spotlight to find a game' },
            { keys: [['↑'], ['↓']], label: 'Move through results' },
            { keys: [['Enter']], label: 'Add game (Spotlight stays open)' },
            { keys: [['Ctrl', 'Enter']], label: 'Add game and start playing' },
            { keys: [['Alt', '1…5']], label: 'Add 1, 5, 10, 50 or 100 random games (from what you searched)' },
            { keys: [['Esc']], label: 'Close Spotlight' },
        ],
    },
    {
        title: 'Library',
        items: [
            { keys: [['↑'], ['↓']], label: 'Move between games (also J / K)' },
            { keys: [['Enter']], label: 'Play / stop the focused game' },
            { keys: [['Space']], label: 'Check / uncheck the focused game' },
            { keys: [['Shift', 'Click']], label: 'Check a range of games' },
            { keys: [['Ctrl', 'A']], label: 'Check all / none' },
            { keys: [['Del']], label: 'Remove checked games (or the focused one)' },
            { keys: [['Esc']], label: 'Clear checkmarks' },
            { keys: [['Double-click']], label: 'Play / stop a game' },
        ],
    },
    {
        title: 'Everywhere',
        items: [
            { keys: [['Ctrl', 'L']], label: 'Launch checked games (or all)' },
            { keys: [['Ctrl', 'Shift', 'L']], label: 'Stop all games' },
            { keys: [['Ctrl', 'T']], label: 'Timed run for checked games (or all)' },
            { keys: [['Ctrl', 'Shift', 'X']], label: 'Panic Abort: stop everything' },
            { keys: [['Ctrl', '1'], ['Ctrl', '2'], ['Ctrl', '3']], label: 'Switch to Library / Activity / Settings' },
            { keys: [['?']], label: 'Show this help' },
        ],
    },
];
</script>

<template>
    <BaseModal :open="open" title="Keyboard shortcuts" width="36rem" @close="emit('close')">
        <div class="grid gap-5">
            <section v-for="group in groups" :key="group.title">
                <h3 class="section-label mb-1">{{ group.title }}</h3>
                <div class="divide-y divide-line">
                    <div v-for="item in group.items" :key="item.label" class="flex items-center justify-between gap-4 py-2">
                        <span class="text-sm text-ink">{{ item.label }}</span>
                        <span class="flex items-center gap-1.5 shrink-0">
                            <template v-for="(combo, ci) in item.keys" :key="ci">
                                <span v-if="ci > 0" class="text-faint text-xs">or</span>
                                <span class="flex items-center gap-1">
                                    <span v-for="key in combo" :key="key" class="kbd">{{ key }}</span>
                                </span>
                            </template>
                        </span>
                    </div>
                </div>
            </section>
        </div>
    </BaseModal>
</template>
