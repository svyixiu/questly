<script setup lang="ts">
import { computed } from 'vue';
import { getCurrentOS, isMacOS } from '@/constants/constants';
import type { Game, GameExecutable } from '@/types/types';
import { useGameLibrary } from '@/composables/game-library';
import {
    defaultExecutable,
    platformExecutables,
    splitExecutableName,
    usesCrossPlatformFallback,
} from '@/utils/executables';

const props = defineProps<{
    game: Game
}>();

const library = useGameLibrary();

const currentPlatform = getCurrentOS();
const isMac = isMacOS();

const executables = computed(() => platformExecutables(props.game));
const usingCrossPlatformFallback = computed(() => usesCrossPlatformFallback(props.game));
const defaultExe = computed(() => defaultExecutable(props.game));
const isBusy = computed(() => library.busy.value.has(props.game.uid!));

function handleLaunch(executable: GameExecutable) {
    if (isBusy.value) return;
    if (executable.is_running) library.stop(props.game, executable);
    else library.launch(props.game, executable);
}
</script>

<template>
    <div>
        <p v-if="isMac" class="mb-2 text-xs text-muted">
            A small game window opens while playing. Discord on macOS usually only detects apps with a visible window.
        </p>
        <p v-if="usingCrossPlatformFallback" class="mb-2 text-xs text-warn">
            No executable is registered for your platform, so another platform's name is used as a fallback.
        </p>

        <div v-if="executables.length === 0" class="text-sm text-ink-2 rounded-2xl bg-warn-soft p-3">
            Discord hasn't registered any launchable executables for this game on your platform ({{ currentPlatform }}).
        </div>

        <div v-else class="space-y-1">
            <div v-for="executable in executables" :key="executable.name"
                class="exe flex items-center gap-3 rounded-2xl px-2.5 py-2"
                :class="{ selected: defaultExe?.name === executable.name }"
                @click="library.setSelectedExe(game, executable.name)">
                <span class="radio" :class="{ on: defaultExe?.name === executable.name }"></span>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1 overflow-x-auto scrollbar-none fade-right pr-3">
                        <template v-for="(section, i) in splitExecutableName(executable)" :key="i">
                            <span v-if="i > 0" class="text-faint text-xs">/</span>
                            <span class="font-mono text-[12.5px] whitespace-nowrap"
                                :class="i === splitExecutableName(executable).length - 1 ? 'text-ink font-semibold' : 'text-muted'">
                                {{ section }}
                            </span>
                        </template>
                    </div>
                    <div class="flex items-center gap-1.5 mt-0.5 text-[11px] text-faint uppercase tracking-wider font-semibold">
                        <span>{{ executable.os }}</span>
                        <span v-if="executable.is_launcher" class="text-warn">· launcher</span>
                    </div>
                </div>
                <button class="btn btn-sm" :disabled="isBusy"
                    :class="executable.is_running ? 'btn-danger' : 'btn-glass'"
                    @click.stop="handleLaunch(executable)">
                    {{ executable.is_running ? 'Stop' : 'Play' }}
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.exe {
    transition: background-color 150ms ease;
}

.exe:hover {
    background: var(--glass-2);
}

.exe.selected {
    background: var(--glass-2);
}

.radio {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
    flex-shrink: 0;
    position: relative;
    transition: box-shadow 150ms ease;
}

.radio::after {
    content: "";
    position: absolute;
    inset: 4px;
    border-radius: inherit;
    background: var(--on-accent);
    transform: scale(0);
    transition: transform 320ms var(--ease-spring);
}

.radio.on {
    background: var(--accent);
    box-shadow: none;
}

.radio.on::after {
    transform: scale(1);
}

.fade-right {
    -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%);
    mask-image: linear-gradient(to right, black 85%, transparent 100%);
}

.scrollbar-none::-webkit-scrollbar {
    display: none;
}
</style>
