import type { ISchoolConfiguration } from "../models/configuration/ISchoolConfiguration";

/**
 * Check that a required identifier or explanation contains non-whitespace text.
 * @param value - The value to check.
 * @param name - The field name used in an error.
 */
export function requireText(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} is required`);
}

/**
 * Convert an ISO timestamp with an explicit offset into an instant.
 * @param value - The timestamp, including Z or a numeric time zone offset.
 * @returns Milliseconds since the Unix epoch.
 */
export function parseInstant(value: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    throw new Error("Timestamp must include an explicit time zone");
  }
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ms = Date.parse(value);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maxDay ||
    !Number.isFinite(ms)
  )
    throw new Error("Invalid timestamp");
  return ms;
}

/**
 * Validate a non-empty, duplicate-free list of category names.
 * @param values - The category names to validate.
 */
export function validateCategoryPriority(values: string[]): void {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some(
      (value) =>
        typeof value !== "string" ||
        value.trim() !== value ||
        value.length === 0,
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new Error("categoryPriority must contain unique, non-empty names");
  }
}

/**
 * Validate essential school settings while retaining every supplied field.
 * @param configuration - The school-specific settings to validate.
 */
export function validateConfiguration(
  configuration: ISchoolConfiguration,
): void {
  if (
    !configuration ||
    typeof configuration !== "object" ||
    !configuration.allocation ||
    typeof configuration.allocation !== "object"
  )
    throw new Error("School allocation configuration is required");
  validateCategoryPriority(configuration.allocation.category_priority);
  if (
    !Array.isArray(configuration.allocation.tie_break) ||
    configuration.allocation.tie_break.length === 0 ||
    configuration.allocation.tie_break.some(
      (value) => typeof value !== "string" || value.trim().length === 0,
    )
  )
    throw new Error("allocation tie_break is required");
  if (
    typeof configuration.overpayment !== "string" ||
    configuration.overpayment.trim().length === 0
  )
    throw new Error("overpayment is required");
  if (
    !Array.isArray(configuration.accepted_currencies) ||
    configuration.accepted_currencies.length === 0 ||
    configuration.accepted_currencies.some(
      (value: unknown) =>
        typeof value !== "string" || value.trim().length === 0,
    )
  )
    throw new Error("accepted_currencies is required");
  const fx = configuration.fx;
  if (
    !fx ||
    typeof fx !== "object" ||
    Array.isArray(fx) ||
    !("source" in fx) ||
    !(fx.source === null || typeof fx.source === "string") ||
    !("rates" in fx) ||
    !fx.rates ||
    typeof fx.rates !== "object" ||
    Array.isArray(fx.rates)
  )
    throw new Error("fx source and rates are required");
  for (const field of [
    "grace_period_days",
    "arrears_after_days_past_due",
  ] as const) {
    const value = configuration[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw new Error(`${field} must be a non-negative integer`);
  }
  const reminders = configuration.reminders;
  if (
    !reminders ||
    typeof reminders !== "object" ||
    Array.isArray(reminders) ||
    !("cadence_days" in reminders) ||
    !Array.isArray(reminders.cadence_days) ||
    reminders.cadence_days.some(
      (value: unknown) =>
        typeof value !== "number" || !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw new Error(
      "reminder cadence_days must be a list of non-negative integers",
    );
  const serialized = JSON.stringify(configuration, (_key, value: unknown) => {
    if (
      value === undefined ||
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "bigint" ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      throw new Error("Configuration must contain only JSON values");
    }
    return value;
  });
  if (serialized === undefined)
    throw new Error("Configuration must be JSON-serializable");
}
