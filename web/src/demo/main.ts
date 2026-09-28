// The real Questly app, running in the browser on a pretend PC.
import './runtime' // first: the fake backend has to exist before the app starts
import '@fontsource-variable/archivo'
import './demo.css'
import { createApp } from 'vue'
import App from '@/App.vue'
import { useSettings } from '@/composables/settings'

useSettings()
createApp(App).mount('#app')
