<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { recordAgreement, useSettings } from '@/composables/settings';
import { useInstaller } from '@/composables/installer';
import { hasAgreed } from '@/data/legal';
import BaseModal from './BaseModal.vue';
import RiskTerms from './RiskTerms.vue';

/**
 * Shown until the risk notice and the current Terms are accepted: on first
 * use without installing, after "Review" in Settings, and when the Terms
 * change. Declining quits.
 */
const { settings } = useSettings();
const installer = useInstaller();
const open = computed(() => !hasAgreed(settings.value));
const risk = ref(false);
const terms = ref(false);
watch(open, isOpen => {
    if (isOpen) {
        risk.value = false;
        terms.value = false;
    }
});

function accept() {
    if (risk.value && terms.value) recordAgreement(settings);
}
</script>

<template>
    <BaseModal :open="open" persistent eyebrow="Before you start" title="Your account, your responsibility." width="38rem"
        @close="() => {}">
        <RiskTerms v-model:risk="risk" v-model:terms="terms" />
        <template #footer>
            <button class="btn btn-glass" @click="installer.quit()">Quit</button>
            <button class="btn btn-primary" :disabled="!risk || !terms" @click="accept">I agree</button>
        </template>
    </BaseModal>
</template>
