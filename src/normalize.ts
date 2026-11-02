/** URL identity contract v2; compatible with agentsweb's url-identity.ts. */
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "twclid", "ttclid", "li_fat_id", "igshid",
  "mc_cid", "mc_eid", "mkt_tok", "_ga", "_gl", "_hsenc", "_hsmi", "wbraid", "gbraid",
]);

export function normalizeUrl(input: string): string {
  const raw = input.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  if (!/^#!?\//.test(url.hash)) url.hash = "";
  const signed = [...url.searchParams.keys()].some((key) => /^(x-amz-|x-goog-|signature$|sig$|token$)/i.test(key));
  if (!signed) {
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
  }
  // Scheme, www, path case, trailing slash, ref, variant and access can change content.
  return url.toString();
}
