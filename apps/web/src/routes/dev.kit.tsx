import { createFileRoute } from '@tanstack/react-router'
import { KitPage } from './-dev-kit/kit-page'

// Design kit showcase. Fake data only; safe to ship, not linked from the app.
export const Route = createFileRoute('/dev/kit')({
  component: KitPage,
})
