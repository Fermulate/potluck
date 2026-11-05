import { t } from '@potluck/i18n'

export function HomePage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <h1 className="text-4xl font-semibold tracking-tight">{t('app.name')}</h1>
    </main>
  )
}
