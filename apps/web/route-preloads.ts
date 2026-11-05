import type { Plugin, Rolldown } from 'vite'

type OutputChunk = Rolldown.OutputChunk

/**
 * Route chunks are only requested after the entry script has run and the router has matched
 * the URL, which puts a full round trip of waiting in front of every first paint. This plugin
 * writes a tiny inline script into index.html that, before the entry even starts, adds
 * `modulepreload` links for what the current URL is about to need:
 *
 *   - signed out on `/`: the landing demo (the page itself is prerendered);
 *   - signed in (a supabase-js session is stored): the Supabase client, the app shell and, on
 *     `/` or `/home`, the home screen, plus a preconnect to the API.
 *
 * Only files the entry does not already preload are listed. The script also marks the document
 * `data-boot="app"` whenever the app has to start instead of the prerendered landing page
 * (prerender-landing.ts): any other URL, a stored session, or an auth result in the URL. The
 * same rule decides in main.tsx whether the app renders.
 */
export function routePreloads(apiUrl: string | undefined): Plugin {
  return {
    name: 'potluck:route-preloads',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return
        const chunks = Object.values(ctx.bundle).filter((c): c is OutputChunk => c.type === 'chunk')
        const byName = new Map(chunks.map((c) => [c.fileName, c]))
        const closure = (roots: OutputChunk[]) => {
          const seen = new Set<string>()
          const stack = roots.map((c) => c.fileName)
          while (stack.length) {
            const name = stack.pop()!
            if (seen.has(name)) continue
            seen.add(name)
            stack.push(...(byName.get(name)?.imports ?? []))
          }
          return seen
        }
        const entry = chunks.filter((c) => c.isEntry)
        const preloaded = closure(entry)
        const containing = (suffix: string) =>
          chunks.filter((c) => c.moduleIds.some((id) => id.replace(/\\/g, '/').endsWith(suffix)))
        const files = (...suffixes: string[]) => {
          const roots = suffixes.flatMap(containing)
          if (roots.length === 0)
            this.warn(`route-preloads: nothing matched ${suffixes.join(', ')}`)
          return [...closure(roots)].filter((f) => !preloaded.has(f)).map((f) => `/${f}`)
        }
        const app = files('src/lib/supabase.ts', 'src/routes/_app.tsx?tsr-split=component')
        const map = {
          landing: files('src/features/shell/hero-island.tsx'),
          app,
          home: files('src/routes/_app/home.tsx?tsr-split=component').filter(
            (f) => !app.includes(f),
          ),
          api: apiUrl ? new URL(apiUrl).origin : null,
        }
        const script = `(function(){var m=${JSON.stringify(map)},p=location.pathname,s=false,l,i,e;
try{for(i=0;i<localStorage.length;i++)if(/^sb-.+-auth-token$/.test(localStorage.key(i)||''))s=true}catch(x){}
l=s?m.app.concat(p==='/'||p==='/home'?m.home:[]):p==='/'?m.landing:[];
function add(r,h){e=document.createElement('link');e.rel=r;e.href=h;e.crossOrigin='';document.head.appendChild(e)}
if(p!=='/'||s||/(access_token|refresh_token|code|token_hash|error_description)=/.test(location.search+location.hash))document.documentElement.setAttribute('data-boot','app');
if(s&&m.api)add('preconnect',m.api);
for(i=0;i<l.length;i++)add('modulepreload',l[i])})()`
        return [{ tag: 'script', children: script, injectTo: 'head' }]
      },
    },
  }
}
