/**
 * useFormatMoney — reactive money-formatting hook.
 *
 * Returns a set of formatting functions that automatically reflect the user's
 * current currency, exchange rate, and Bliss Mode preference.  Display sites
 * only need to pull this one hook — no extra params needed at the call site.
 *
 * Usage:
 *   const { fmt, fmtCompact, fmtDelta } = useFormatMoney();
 *   <Text>{fmt(pedal.purchase_price)}</Text>   // "$1,234" | "£974" | "•••"
 *   <Text>{fmtCompact(totalMarketValue)}</Text> // "$12.3k"
 *   <Text>{fmtDelta(marketValue - paid)}</Text> // "+$150" | "-£42"
 *
 * All amounts are assumed to be stored in USD.  The hook multiplies by the
 * live exchange rate before formatting.
 */

import { useStore } from './useStore';
import { formatMoney, formatMoneyCompact, formatDelta } from '../lib/formatMoney';
import type { CurrencyCode } from '../lib/formatMoney';

export function useFormatMoney() {
  const currency = useStore(s => s.currency) as CurrencyCode;
  const wifeMode = useStore(s => s.wifeMode);
  const exchangeRates = useStore(s => s.exchangeRates);

  // USD is always 1:1 — no conversion needed
  const rate = currency === 'USD' ? 1 : (exchangeRates[currency] ?? 1);

  return {
    /** Standard format: "$1,234" or "•••" in Bliss Mode */
    fmt: (amount: number | null | undefined) =>
      formatMoney(amount, currency, wifeMode, rate),

    /** Compact k-suffix: "$12.3k" */
    fmtCompact: (amount: number) =>
      formatMoneyCompact(amount, currency, wifeMode, rate),

    /** Delta with sign: "+$150" or "-£42" */
    fmtDelta: (delta: number) =>
      formatDelta(delta, currency, wifeMode, rate),
  };
}
