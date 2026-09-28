<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSettings } from '@/composables/settings';
import { useInstaller } from '@/composables/installer';
import BaseModal from './BaseModal.vue';
import RiskTerms from './RiskTerms.vue';

/**
 * Shown when the rules haven't been accepted yet (e.g. running without
 * installing, or after "Review" in Settings). Declining quits.
 */
const { settings } = useSettings();
const installer = useInstaller();
const open = computed(() => settings.value.riskAcceptedAt === null);
const agreed = ref(false);
watch(open, isOpen => { if (isOpen) agreed.value = false; });

function accept() {
    if (agreed.value) settings.value.riskAcceptedAt = Date.now();
}
</script>

<template>
    <BaseModal :open="open" persistent eyebrow="Before you start" title="Your account, your responsibility." width="38rem"
        @close="() => {}">
        <RiskTerms v-model="agreed" />
        <template #footer>
            <button class="btn btn-glass" @click="installer.quit()">Quit</button>
            <button class="btn btn-primary" :disabled="!agreed" @click="accept">I understand</button>
        </template>
    </BaseModal>
</template>
