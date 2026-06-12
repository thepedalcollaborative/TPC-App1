/**
 * useMessageGate
 *
 * Holds the advisor message-counter state. Quota is now enforced and
 * consumed server-side inside the tpc-advisor edge function (closing the
 * bypass where a modified client skipped the old check-and-gate-message
 * pre-check). The client just renders whatever quota the server returns:
 * call applyQuota() with the `quota` object from each advisor response.
 */

import { useState, useCallback } from 'react';
import type { QuotaInfo } from '../lib/anthropic';

export type GateError = 'pro_required' | 'messages_depleted' | 'network_error';

export type GateState = {
  used: number;
  allotment: number;
  credits: number;
  /** true when used >= allotment (falling back to credits) */
  onCredits: boolean;
  /** set for free-tier users instead of used/allotment */
  freeUsed?: number;
  freeAllotment?: number;
};

export function useMessageGate() {
  const [gateState, setGateState] = useState<GateState | null>(null);

  const applyQuota = useCallback((quota: QuotaInfo | undefined) => {
    if (!quota) return;

    if (quota.used_credit) {
      setGateState(prev => ({
        used: prev?.used ?? 50,
        allotment: prev?.allotment ?? 50,
        credits: typeof quota.credits === 'number' ? quota.credits : 0,
        onCredits: true,
      }));
    } else if (quota.free_used != null) {
      // Free tier
      setGateState({
        used: 0,
        allotment: 0,
        credits: 0,
        onCredits: false,
        freeUsed: quota.free_used,
        freeAllotment: typeof quota.free_allotment === 'number' ? quota.free_allotment : 3,
      });
    } else {
      setGateState({
        used: typeof quota.used === 'number' ? quota.used : 0,
        allotment: typeof quota.allotment === 'number' ? quota.allotment : 50,
        credits: typeof quota.credits === 'number' ? quota.credits : 0,
        onCredits: false,
      });
    }
  }, []);

  return { gateState, applyQuota };
}
