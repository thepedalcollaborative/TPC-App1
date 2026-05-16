/**
 * Money formatting utility.
 *
 * Centralises all currency display logic so Wife Mode and currency preference
 * can be toggled from one place and automatically apply everywhere in the app.
 *
 * Wife Mode replaces every dollar amount with "•••" so the user can hand
 * their phone to someone without exposing collection values.
 */

export const CURRENCIES = [
  { code: 'USD', symbol: '$',    label: 'US Dollar',         locale: 'en-US' },
  { code: 'EUR', symbol: '€',    label: 'Euro',              locale: 'de-DE' },
  { code: 'GBP', symbol: '£',    label: 'British Pound',     locale: 'en-GB' },
  { code: 'CAD', symbol: 'CA$',  label: 'Canadian Dollar',   locale: 'en-CA' },
  { code: 'AUD', symbol: 'A$',   label: 'Australian Dollar', locale: 'en-AU' },
  { code: 'JPY', symbol: '¥',    label: 'Japanese Yen',      locale: 'ja-JP' },
] as const;

export type CurrencyCode = typeof CURRENCIES[number]['code'];

const getCurr = (code: CurrencyCode) =>
  CURRENCIES.find(c => c.code === code) ?? CURRENCIES[0];

/**
 * Standard money display.
 *
 * @param amount  - Raw USD amount (or null/undefined for no value)
 * @param currency - Target display currency
 * @param wifeMode - If true, returns "•••" regardless of amount
 * @param rate     - Exchange rate multiplier (USD → currency). Defaults to 1.
 *
 * formatMoney(1234, 'USD', false, 1)    → "$1,234"
 * formatMoney(1234, 'GBP', false, 0.79) → "£974"
 * formatMoney(1234, 'USD', true,  1)    → "•••"
 * formatMoney(null, 'USD', false,  1)   → "—"
 */
export function formatMoney(
  amount: number | null | undefined,
  currency: CurrencyCode = 'USD',
  wifeMode = false,
  rate = 1,
): string {
  if (wifeMode) return '•••';
  if (amount == null || isNaN(amount)) return '—';
  const curr = getCurr(currency);
  const converted = Math.round(amount * rate);
  return `${curr.symbol}${Math.abs(converted).toLocaleString(curr.locale, { maximumFractionDigits: 0 })}`;
}

/**
 * Compact format with k-suffix for large values.
 * formatMoneyCompact(1234, 'GBP', false, 0.79) → "£1k"
 */
export function formatMoneyCompact(
  amount: number,
  currency: CurrencyCode = 'USD',
  wifeMode = false,
  rate = 1,
): string {
  if (wifeMode) return '•••';
  const curr = getCurr(currency);
  const converted = amount * rate;
  if (converted >= 1000) {
    const k = converted / 1000;
    const str = k % 1 === 0 ? k.toFixed(0) : k.toFixed(1);
    return `${curr.symbol}${str}k`;
  }
  return `${curr.symbol}${Math.round(converted).toLocaleString(curr.locale, { maximumFractionDigits: 0 })}`;
}

/**
 * Delta (profit/loss) with leading +/- sign.
 * formatDelta(150, 'GBP', false, 0.79) → "+£118"
 * formatDelta(150, 'USD', true,  1)    → "•••"
 */
export function formatDelta(
  delta: number,
  currency: CurrencyCode = 'USD',
  wifeMode = false,
  rate = 1,
): string {
  if (wifeMode) return '•••';
  const curr = getCurr(currency);
  const converted = delta * rate;
  const prefix = converted >= 0 ? '+' : '-';
  return `${prefix}${curr.symbol}${Math.abs(Math.round(converted)).toLocaleString(curr.locale, { maximumFractionDigits: 0 })}`;
}
