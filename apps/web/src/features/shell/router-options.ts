import { RouteError, RouteNotFound } from './route-error'

/** What the app's router shows when a screen throws or an address matches no screen. */
export const routerFallbacks = {
  // A screen that throws shows our own page, with a retry and a way home, in place of the
  // router's unstyled default.
  defaultErrorComponent: RouteError,
  // An address no screen answers to gets a page with a way home, not the bare "Not Found". It
  // is a whole page, so a miss under a layout (a group, the app frame) shows it at the root too.
  defaultNotFoundComponent: RouteNotFound,
  notFoundMode: 'root',
} as const
