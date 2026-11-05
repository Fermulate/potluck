import { createServer, type Plugin, type ResolvedConfig } from 'vite'

/**
 * The app is rendered in the browser, so a first visit sees a blank page until every script
 * has downloaded and run. The landing page is static, so this plugin renders it once at build
 * time (src/prerender.tsx) and puts the HTML inside #root. The client then renders the same
 * page over it. The design token stylesheet, which main.tsx otherwise injects at startup, is
 * inlined too: without it the first paint of any screen is laid out with missing variables.
 *
 * index.html is also the fallback for every other URL. The boot script from route-preloads.ts
 * marks the document `data-boot="app"` when the URL is not `/` or a session is stored, and the
 * inline style hides the prerendered page in that case, so nobody else ever sees it flash.
 */
export function prerenderLanding(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'potluck:prerender-landing',
    apply: 'build',
    configResolved(resolved) {
      config = resolved
    },
    transformIndexHtml: {
      // Before the PWA plugin hashes index.html for the precache manifest.
      order: 'post',
      async handler(html) {
        const marker = '<div id="root"></div>'
        if (!html.includes(marker)) throw new Error('prerender: #root not found in index.html')
        const server = await createServer({
          configFile: false,
          root: config.root,
          envDir: config.envDir,
          resolve: { alias: config.resolve.alias },
          logLevel: 'error',
          appType: 'custom',
          server: { middlewareMode: true, hmr: false, ws: false },
          optimizeDeps: { noDiscovery: true, include: [] },
        })
        try {
          const { renderLanding, tokensCss } = (await server.ssrLoadModule(
            '/src/prerender.tsx',
          )) as { renderLanding: () => Promise<string>; tokensCss: () => string }
          const markup = await renderLanding()
          return (
            html
              // After the title: the charset meta has to stay in the first 1024 bytes.
              .replace('</title>', `</title><style id="pl-tokens">${tokensCss()}</style>`)
              .replace(marker, `<div id="root"><div id="prerender">${markup}</div></div>`)
          )
        } finally {
          await server.close()
        }
      },
    },
  }
}
