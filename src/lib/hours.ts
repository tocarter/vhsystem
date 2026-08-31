export const MAX_HOURS_PER_REQUEST = 24

/**
 * Hours are entered as decimals but stored as whole minutes, so ledger totals
 * are exact integer sums rather than accumulated floating point error.
 */
export function hoursToMinutes(hours: number): number {
  if (!Number.isFinite(hours)) {
    throw new Error('Hours must be a finite number')
  }
  const minutes = Math.round(hours * 60)
  if (Math.abs(hours * 60 - minutes) > 1e-6) {
    throw new Error('Hours must resolve to whole minutes')
  }
  return minutes
}

export function minutesToHours(minutes: number): number {
  return minutes / 60
}

/** Trims to at most two decimals without padding, so 150 reads as "2.5". */
export function formatHours(minutes: number): string {
  return String(Math.round(minutesToHours(minutes) * 100) / 100)
}

export type LedgerLike = { minutes: number }

export function totalMinutes(entries: ReadonlyArray<LedgerLike>): number {
  return entries.reduce((sum, entry) => sum + entry.minutes, 0)
}
