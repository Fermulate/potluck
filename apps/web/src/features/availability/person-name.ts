import type { PlanMember } from '@potluck/api'
import { firstName } from '@potluck/core'
import { t } from '@potluck/i18n'

/** First name, tagged when the person answered through a guest link ("Ana (guest)"). */
export function personName(person: PlanMember | undefined): string {
  const name = firstName(person?.displayName ?? '')
  return person?.guest && name ? t('guests.nameWithTag', { name }) : name
}
