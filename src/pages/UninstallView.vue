<script setup lang="ts">
import { ref } from 'vue';
import { useInstaller } from '@/composables/installer';
import { useGameLibrary } from '@/composables/game-library';
import { useScheduler } from '@/composables/scheduler';
import AnimatedCheckbox from '@/components/AnimatedCheckbox.vue';

const installer = useInstaller();
const { info } = installer;
const library = useGameLibrary();
const scheduler = useScheduler();

const removeData = ref(false);
const working = ref(false);
const error = ref('');

async function uninstall() {
    working.value = true;
    error.value = '';
    try {
        // nothing of Questly's should keep running afterwards
        if (scheduler.isActive.value) await scheduler.cancel({ stopGames: false, quiet: true });
        await library.stopAll();
        await installer.uninstall(removeData.value);
    } catch (e) {
        error.value = (e as Error).message;
        working.value = false;
    }
}
</script>

<template>
    <div class="h-full grid place-items-center px-4 pt-3 pb-8">
        <section class="paper w-full max-w-[34rem] p-8">
            <span class="absolute top-[18px] right-[18px] w-3 h-3 rounded-full bg-ink" aria-hidden="true"></span>
            <div class="eyebrow mb-2">Uninstall</div>
            <h1 class="display text-[34px] leading-[36px] text-ink">Remove Questly?</h1>
            <p class="text-[15px] text-muted mt-3 leading-snug">
                This removes Questly, its shortcuts and its entry in Apps &amp; features. Any games it's running are
                stopped first.
            </p>

            <label class="mt-5 flex items-start gap-3 rounded-2xl border border-line-strong px-4 py-3 cursor-pointer"
                @click.prevent="removeData = !removeData">
                <AnimatedCheckbox :checked="removeData" label="Also delete my data" class="mt-0.5" @toggle="removeData = !removeData" />
                <span class="text-sm text-ink leading-snug">
                    Also delete my library, settings and game files
                    <span class="block text-xs text-muted font-mono mt-0.5">{{ info?.data_dir ?? '%APPDATA%\\Questly' }}</span>
                </span>
            </label>

            <p v-if="error" class="text-sm text-danger mt-4 selectable">{{ error }}</p>

            <div class="flex items-center justify-end gap-2 mt-7">
                <button class="btn btn-glass" :disabled="working" @click="installer.cancelUninstall()">Cancel</button>
                <button class="btn btn-danger" :disabled="working" @click="uninstall">
                    <span v-if="working" class="spinner"></span>
                    Uninstall
                </button>
            </div>
        </section>
    </div>
</template>
