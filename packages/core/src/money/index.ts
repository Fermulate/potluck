export type { Shares } from './allocate'
export {
  checkPayers,
  primaryPayer,
  type Payer,
  type PayersError,
  type PayersResult,
} from './payers'
export {
  roundedUp,
  splitAdjustment,
  splitEqual,
  splitExact,
  splitItemized,
  splitPercent,
  splitShares,
  type SplitBasis,
  type SplitError,
  type SplitExtras,
  type SplitItem,
  type SplitResult,
} from './split'
