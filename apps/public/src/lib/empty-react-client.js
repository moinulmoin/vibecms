// Public marketing/tenant pages are SSR-only React (no client:* islands).
// Astro still emits every renderer clientEntrypoint into dist/client; this stub
// keeps that slot empty so no browser React runtime ships.
export default {};
