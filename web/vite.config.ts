import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// The Questly website. It shares node_modules with the app (repo root) and
// reuses the app's own source (../src) for the in-browser demo.
const web = __dirname
const app = path.resolve(__dirname, '../src')
const gameList = path.resolve(app, 'assets/gamelist.json')

/**
 * Discord's list of detectable games (~11 MB) is served as a static file for
 * the demo, instead of being bundled into its JavaScript like in the app.
 */
function gameListData(): Plugin {
    const url = '/data/detectable.json'
    return {
        name: 'questly-game-list',
        enforce: 'pre',
        // the app's bundled fallback list becomes empty in the demo: it loads /data/detectable.json
        resolveId(id, importer) {
            if (id.endsWith('assets/gamelist.json') && importer?.replace(/\\/g, '/').includes('/src/composables/')) {
                return '\0questly-empty-game-list'
            }
        },
        load(id) {
            if (id === '\0questly-empty-game-list') return 'export default []'
        },
        configureServer(server) {
            server.middlewares.use(url, (_req, res) => {
                res.setHeader('Content-Type', 'application/json')
                fs.createReadStream(gameList).pipe(res)
            })
        },
        generateBundle() {
            this.emitFile({ type: 'asset', fileName: url.slice(1), source: fs.readFileSync(gameList) })
        },
    }
}

/**
 * Plain HTML pages with shared bits: `<!-- include:header -->` pulls in
 * partials/header.html, and %TOKENS% are filled in from release.json.
 */
function sitePages(): Plugin {
    const release = JSON.parse(fs.readFileSync(path.join(web, 'release.json'), 'utf8'))
    const repo = `https://github.com/${release.repo}`
    const tokens: Record<string, string> = {
        REPO_URL: repo,
        SITE_URL: release.site,
        DOWNLOAD_URL: `${repo}/releases/latest/download/Questly.exe`,
        ORIGINAL_URL: 'https://github.com/markterence/discord-quest-completer',
        VERSION: release.version,
        SIZE: release.size,
        SHA256: release.sha256,
        RELEASE_DATE: release.date,
    }
    const fill = (html: string) => html.replace(/%([A-Z0-9_]+)%/g, (m, key) => tokens[key] ?? m)
    // /try → /try.html locally too (Vercel does this with cleanUrls)
    const cleanUrls = (server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) => {
        server.middlewares.use((req, _res, next) => {
            const url = new URL(req.url ?? '/', 'http://x')
            const page = url.pathname.slice(1)
            if (pages.includes(page)) req.url = `/${page}.html${url.search}`
            next()
        })
    }
    return {
        name: 'questly-site-pages',
        configureServer: cleanUrls,
        configurePreviewServer: cleanUrls,
        transformIndexHtml: {
            order: 'pre',
            handler(html) {
                const withPartials = html.replace(/<!--\s*include:([\w-]+)\s*-->/g, (_, name) =>
                    fs.readFileSync(path.join(web, 'partials', `${name}.html`), 'utf8'))
                return fill(withPartials)
            },
        },
    }
}

const pages = ['index', 'try', 'app', 'privacy', 'terms', 'terms-of-use', 'licenses', 'credits', '404']

export default defineConfig({
    root: web,
    publicDir: path.join(web, 'public'),
    plugins: [vue(), tailwindcss(), gameListData(), sitePages()],
    resolve: {
        alias: {
            '@/': `${app}/`,
            '~/': `${path.join(web, 'src')}/`,
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.resolve(web, '../package.json'), 'utf8')).version),
    },
    server: {
        port: 5180,
        fs: { allow: [path.resolve(web, '..')] },
    },
    build: {
        outDir: path.join(web, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: Object.fromEntries(pages.map(p => [p, path.join(web, `${p}.html`)])),
        },
    },
})
