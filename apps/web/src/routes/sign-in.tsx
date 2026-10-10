import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { Button, Field, Input, PageHeader, toast } from '@potluck/ui'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/sign-in')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: SignInPage,
})

function SignInPage() {
  const { redirect } = Route.useSearch()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) {
      toast.error(error.message)
      return
    }
    await navigate({ to: redirect ?? '/home' })
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-sm content-center gap-6 px-4">
      <PageHeader title={t('auth.signIn.title')} subtitle={t('auth.signIn.subtitle')} />
      <form className="grid gap-4" onSubmit={onSubmit}>
        <Field label={t('auth.fields.email')}>
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.fields.emailPlaceholder')}
          />
        </Field>
        <Field label={t('auth.fields.password')}>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {t('auth.signIn.submit')}
        </Button>
      </form>
    </main>
  )
}
