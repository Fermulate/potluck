// Self-hosted fonts. No runtime call to a font CDN.
// Bricolage with the weight and optical size axes. The app never sets font-stretch, so the
// width axis in the "standard" build was 55 kB of latin glyph data nobody saw.
import '@fontsource-variable/bricolage-grotesque/opsz.css'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
