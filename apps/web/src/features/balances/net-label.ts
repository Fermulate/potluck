import { t } from '@potluck/i18n'

/**
 * Words for one person's net balance in a list row: `short` sits above the amount ("is owed",
 * "owes"), `full` is the sentence a screen reader hears for the row ("Kai is owed $12.00").
 * The viewer gets their own grammar ("You are owed $12.00", "are owed"), never "You is owed".
 */
export function netLabel(
  cents: number,
  { name, isViewer, amount }: { name: string; isViewer: boolean; amount: string },
): { short: string; full: string } {
  if (isViewer) {
    if (cents > 0)
      return { short: t('balances.areOwedShort'), full: t('balances.youAreOwed', { amount }) }
    if (cents < 0)
      return { short: t('balances.oweShort'), full: t('balances.youOweNet', { amount }) }
    return { short: t('balances.settledShort'), full: t('balances.youAreSettled') }
  }
  if (cents > 0)
    return { short: t('balances.isOwedShort'), full: t('balances.isOwed', { name, amount }) }
  if (cents < 0)
    return { short: t('balances.owesShort'), full: t('balances.netOwe', { name, amount }) }
  return { short: t('balances.settledShort'), full: t('balances.settled', { name }) }
}
