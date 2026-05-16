/**
 * useMessageGate
 *
 * Wraps the check-and-gate-message edge function.
 * Call checkGate() before each advisor message send.
 * Returns the current gate state for rendering a MessageCounter.
 */

import { useState, useCallback } from 'react';
import { invokeEdgeFunction } from '../lib/supabase';

export type GateError = 'pro_required' | 'messages_depleted' | 'network_error';

export type GateResult =
  | { allowed: true;  usedCredit?: boolean; used?: number; allotment?: number; credits?: number }
  | { allowed: false; error: GateError };

export type GateState = {
  used: number;
  allotment: number;
  credits: number;
  /** true when used >= allotment (falling back to credits) */
  onCredits: boolean;
};

export function useMessageGate() {
  const [gateState, setGateState] = useState<GateState | null>(null);

  const checkGate = useCallback(async (): Promise<GateResult> => {
    try {
      const { data, error } = await invokeEdgeFunction<Record<string, unknown>>(
        'check-and-gate-message',
        {}
      );

      if (error) {
        // Parse HTTP error status from Supabase Functions error shape
        const status = (error as { context?: { status?: number } }).context?.status;
        if (status === 403) return { allowed: false, error: 'pro_required' };
        if (status === 402) return { allowed: false, error: 'messages_depleted' };
        return { allowed: false, error: 'network_error' };
      }

      if (!data) return { allowed: false, error: 'network_error' };

      if (!data.allowed) {
        const err = (data.error as string) ?? 'network_error';
        return { allowed: false, error: err as GateError };
      }

      // Update local gate state for the counter UI
      if (data.used_credit) {
        setGateState(prev => ({
          used: prev?.used ?? 50,
          allotment: prev?.allotment ?? 50,
          credits: typeof data.credits === 'number' ? data.credits : 0,
          onCredits: true,
        }));
      } else {
        setGateState({
          used: typeof data.used === 'number' ? data.used : 0,
          allotment: typeof data.allotment === 'number' ? data.allotment : 50,
          credits: typeof data.credits === 'number' ? data.credits : 0,
          onCredits: false,
        });
      }

      return { allowed: true };
    } catch {
      return { allowed: false, error: 'network_error' };
    }
  }, []);

  return { checkGate, gateState };
}
