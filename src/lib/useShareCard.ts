/**
 * useShareCard — hook for rendering an off-screen ShareCard and sharing it as a PNG.
 *
 * Usage:
 *   const { cardRef, cardData, triggerShare } = useShareCard();
 *
 *   // In your JSX (at component root, outside ScrollView):
 *   <HiddenShareCard cardRef={cardRef} cardData={cardData} />
 *
 *   // To share:
 *   triggerShare({ type: 'pick', brand: 'Boss', model: 'DS-1', why: 'Great drive...' });
 */

import { useRef, useState, useCallback } from 'react';
import { shareAsImage } from './share';
import type { ShareCardData } from '../components/ShareCard';

export function useShareCard() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardRef = useRef<any>(null);
  const [cardData, setCardData] = useState<ShareCardData | null>(null);

  const triggerShare = useCallback(async (data: ShareCardData) => {
    setCardData(data);
    // Give React one frame to render the hidden card before capturing
    await new Promise<void>(resolve => setTimeout(resolve, 160));
    try {
      if (cardRef.current) await shareAsImage(cardRef);
    } finally {
      setCardData(null);
    }
  }, []);

  return { cardRef, cardData, triggerShare };
}
