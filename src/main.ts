import { createApp } from "vue";
// bundled locally: the app's CSP doesn't allow loading web fonts
import '@fontsource-variable/archivo'
import '@/theme/style.css'
import App from "./App.vue";
import { useSettings } from '@/composables/settings';

// apply the saved theme before the first paint
useSettings();

createApp(App).mount("#app");
