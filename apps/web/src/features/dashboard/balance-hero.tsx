import { intlLocale, formatMoney, t } from '@potluck/i18n'
import { Amount } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { BalanceSummary } from './summary'

// Perforated bottom edge, like a bill torn off the pad.
const TEAR =
  'radial-gradient(circle 6px at 50% 100%, #0000 5.5px, #000 6px) 50% 100% / 16px 100% repeat-x'

function GroupLinks({ summary }: { summary: BalanceSummary }) {
  const groups = [...summary.oweGroups, ...summary.owedGroups].slice(0, 5)
  if (groups.length === 0) return null
  return (
    <ul className="mt-4 flex flex-col">
      {groups.map((g) => (
        <li key={g.groupId}>
          <Link
            to="/groups/$groupId"
            params={{ groupId: g.groupId }}
            className="-mx-2 flex items-center gap-2.5 rounded-[0.625rem] px-2 py-1.5 text-sm hover:bg-on-hero/10"
          >
            <span aria-hidden className="w-5 shrink-0 text-center">
              {g.groupEmoji ?? '•'}
            </span>
            <span className="min-w-0 flex-1 truncate">{g.groupName}</span>
            <Amount
              cents={g.netCents}
              currency={summary.currency}
              locale={intlLocale()}
              surface="hero"
              sign="never"
              srLabel={
                g.netCents < 0
                  ? t('home.balance.owe', { amount: formatMoney(-g.netCents, summary.currency) })
                  : t('home.balance.owed', { amount: formatMoney(g.netCents, summary.currency) })
              }
              className="font-semibold"
            />
            <ChevronRight aria-hidden className="size-4 shrink-0 text-hero-mute" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** The bill torn off the pad: overall net, counted up, then who owes whom. */
export function BalanceHero({ summary }: { summary: BalanceSummary }) {
  const { currency, net } = summary
  const headline =
    net > 0
      ? t('home.balance.headlineOwed')
      : net < 0
        ? t('home.balance.headlineOwe')
        : t('home.balance.headlineSettled')
  const label =
    net > 0
      ? t('home.balance.owed', { amount: formatMoney(net, currency) })
      : net < 0
        ? t('home.balance.owe', { amount: formatMoney(-net, currency) })
        : t('home.balance.settled')

  return (
    <section
      aria-label={t('home.balance.title')}
      className="relative overflow-hidden rounded-t-[1.375rem] on-hero px-5 pt-5 pb-8"
      style={{ mask: TEAR, WebkitMask: TEAR }}
    >
      <div className="flex items-center justify-between text-sm text-hero-mute">
        <span>
          {t('home.balance.title')}, {t('home.balance.acrossGroups', { count: summary.groupCount })}
        </span>
        <span className="tabular">{currency}</span>
      </div>
      <p className="mt-5 flourish text-2xl leading-none text-hero-mute">{headline}</p>
      {net === 0 ? (
        <p className="mt-1 font-display text-[3.75rem] leading-[0.95] tracking-[-0.02em] text-hero-olive italic">
          {t('home.balance.settled')}
        </p>
      ) : (
        <div className="mt-1 text-[4.25rem] leading-[0.95] font-extrabold tracking-[-0.045em] sm:text-[4.75rem]">
          <Amount
            cents={Math.abs(net)}
            currency={currency}
            locale={intlLocale()}
            surface="hero"
            tone={net > 0 ? 'owed' : 'owe'}
            split
            countUp
            srLabel={label}
          />
        </div>
      )}
      {net === 0 && <p className="mt-2 text-sm text-hero-mute">{t('home.balance.settledHint')}</p>}
      <div aria-hidden className="my-5 border-t border-dashed border-current opacity-25" />
      <div className="grid grid-cols-2 gap-5">
        <div className="min-w-0">
          <p className="text-sm text-hero-mute">{t('home.balance.youOwe')}</p>
          <p className="mt-0.5 text-lg font-bold">
            <Amount
              cents={-summary.owe}
              currency={currency}
              locale={intlLocale()}
              surface="hero"
              tone="owe"
            />
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-sm text-hero-mute">{t('home.balance.owedToYou')}</p>
          <p className="mt-0.5 text-lg font-bold">
            <Amount
              cents={summary.owed}
              currency={currency}
              locale={intlLocale()}
              surface="hero"
              tone="owed"
            />
          </p>
        </div>
      </div>
      <GroupLinks summary={summary} />
      {summary.otherCurrencies.length > 0 && (
        <p className="mt-4 text-xs text-hero-mute">
          {t('home.balance.otherCurrencies', { currencies: summary.otherCurrencies.join(', ') })}
        </p>
      )}
    </section>
  )
}
