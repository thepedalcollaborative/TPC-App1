// ─── Reverb Affiliate Links (AWIN) ───────────────────────────────────────────
// All outbound links to reverb.com must go through this module.
// This ensures every link carries the AWIN affiliate tracking parameters.

const AWIN_MID = '67144';
const AWIN_AFFID = '1515586';
const AWIN_BASE = 'https://www.awin1.com/cread.php';

/**
 * Wrap any reverb.com URL in the AWIN affiliate deep link.
 * Use this when you already have a full Reverb product/listing URL.
 */
export function reverbAffiliateUrl(reverbUrl: string): string {
  return `${AWIN_BASE}?awinmid=${AWIN_MID}&awinaffid=${AWIN_AFFID}&ued=${encodeURIComponent(reverbUrl)}`;
}

/**
 * Build an AWIN-wrapped Reverb marketplace search URL from a search query.
 * Use this when you have a pedal name and want to link to search results.
 */
export function reverbSearchUrl(query: string): string {
  const destination = `https://reverb.com/marketplace?query=${encodeURIComponent(query)}`;
  return reverbAffiliateUrl(destination);
}
