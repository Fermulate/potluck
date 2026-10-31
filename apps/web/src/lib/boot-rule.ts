/**
 * What decides, before any script runs, whether a visit to `/` is signed out. The inline boot
 * script (route-preloads.ts) and `getSession` (auth.ts) both apply these: a stored supabase-js
 * session or an auth result in the URL means the app has to start.
 */

/** The localStorage key supabase-js keeps the session under. */
export const STORED_SESSION_KEY = /^sb-.+-auth-token$/

/** An auth result (OAuth, magic link, recovery) arriving in the URL's search or hash. */
export const AUTH_RESULT_IN_URL = /(access_token|refresh_token|code|token_hash|error_description)=/
