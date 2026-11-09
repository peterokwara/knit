import { createHash } from 'node:crypto'

/**
 * Serialize JSON objects with stable property ordering for idempotency keys.
 * @param value The value to serialize.
 * @returns The stable JSON serialization.
 */
export function stableJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize)
    if (current && typeof current === 'object') {
      return Object.fromEntries(Object.entries(current).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]))
    }
    return current
  }
  return JSON.stringify(normalize(value))
}

/**
 * Hash stable JSON as a compact deterministic identity.
 * @param value The value to hash.
 * @returns The SHA-256 hash in hexadecimal form.
 */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

/**
 * Parse a non-negative decimal currency amount into minor units without floats.
 * @param value The provider amount.
 * @param label The field name used in validation errors.
 * @returns The amount in minor currency units.
 */
export function parseAmountMinor(value: unknown, label: string): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label} must be a decimal amount`)
  const source = String(value).trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(source)) throw new Error(`${label} is not a non-negative amount with at most two decimal places`)
  const text = source.replaceAll(',', '')
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) throw new Error(`${label} is not a non-negative amount with at most two decimal places`)
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(minor)) throw new Error(`${label} exceeds the safe amount range`)
  return minor
}

/**
 * Convert an M-Pesa local transaction timestamp to a UTC instant.
 * @param value M-Pesa's YYYYMMDDHHmmss timestamp.
 * @param timeZone The school's time zone.
 * @returns The transaction instant in UTC.
 */
export function parseLocalTransactionTime(value: unknown, timeZone: string): string {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) throw new Error('M-Pesa TransTime must use YYYYMMDDHHmmss')
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  const hour = Number(value.slice(8, 10))
  const minute = Number(value.slice(10, 12))
  const second = Number(value.slice(12, 14))
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'iso8601',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const dateParts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  const projected = dateParts(new Date(localAsUtc))
  const projectedAsUtc = Date.UTC(Number(projected.year), Number(projected.month) - 1, Number(projected.day), Number(projected.hour), Number(projected.minute), Number(projected.second))
  const instant = new Date(localAsUtc - (projectedAsUtc - localAsUtc))
  const check = dateParts(instant)
  if (`${check.year}${check.month}${check.day}${check.hour}${check.minute}${check.second}` !== value) {
    throw new Error(`M-Pesa TransTime ${value} is invalid in ${timeZone}`)
  }
  return instant.toISOString()
}
