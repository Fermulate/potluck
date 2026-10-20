import type { HomeBalance } from '@potluck/api'
import { formatMoney, t } from '@potluck/i18n'
import { Amount } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import type { BalanceSummary } from './summary'

// Perforated bottom edge, like a bill torn off the pad.
const TEAR =
  'radial-gradient(circle 6px at 50% 100%, #0000 5.5px, #000 6px) 50% 100% / 16px 100% repeat-x'

function GroupLinks({ groups, currency }: { groups: HomeBalance[]; currency: string }) {
  if (groups.length === 0) {
    return <p className="mt-1 text-sm text-hero-mute">{t('home.balance.nobody')}</p>
  }
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5">
      {groups.slice(0, 3).map((g) => (
        <li key={g.groupId}>
          <Link
            to="/groups/$groupId"
            params={{ groupId: g.groupId }}
            aria-label={t('home.balance.seeGroup', { group: g.groupName })}
            className="-mx-1.5 flex items-center gap-1.5 rounded-[0.5rem] px-1.5 py-1 text-sm hover:bg-on-hero/10"
          >
            <span aria-hidden className="shrink-0">
              {g.groupEmoji ?? '•'}
            </span>
            <span className="min-w-0 flex-1 truncate text-hero-mute">{g.groupName}</span>
            <span className="tabular font-semibold">
              {formatMoney(Math.abs(g.netCents), currency)}
            </span>
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
            <Amount cents={-summary.owe} currency={currency} surface="hero" tone="owe" />
          </p>
          <GroupLinks groups={summary.oweGroups} currency={currency} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-hero-mute">{t('home.balance.owedToYou')}</p>
          <p className="mt-0.5 text-lg font-bold">
            <Amount cents={summary.owed} currency={currency} surface="hero" tone="owed" />
          </p>
          <GroupLinks groups={summary.owedGroups} currency={currency} />
        </div>
      </div>
      {summary.otherCurrencies.length > 0 && (
        <p className="mt-4 text-xs text-hero-mute">
          {t('home.balance.otherCurrencies', { currencies: summary.otherCurrencies.join(', ') })}
        </p>
      )}
    </section>
  )
}
