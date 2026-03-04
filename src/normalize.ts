const STRIP_PARAMS = new Set([
  // UTM / campaign tracking
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_reader", "utm_name", "utm_brand", "utm_social", "utm_social-type",
  // Platform click IDs
  "fbclid", "gclid", "msclkid", "twclid", "ttclid", "li_fat_id", "igshid",
  "s_kwcid", "dclid", "wbraid", "gbraid",
  // Email marketing
  "mc_cid", "mc_eid", "oly_enc_id", "oly_anon_id", "vero_id", "vero_conv",
  "mkt_tok", "hmb_campaign", "hmb_source", "hmb_medium",
  // Paywall / checkout triggers
  "embedded-checkout", "unlocked", "gift", "giftcopy", "paywall",
  "access", "preview", "allow_access", "free_access", "member_access",
  // Publisher referral
  "ref", "referer", "referrer", "source", "origin", "via", "from",
  "partner", "affiliate",
  // Analytics / session
  "_ga", "_gl", "_hsenc", "_hsmi", "icid", "ncid", "cid", "sid",
  "sessionid", "visitorid",
  // A/B testing
  "variation", "variant", "experiment", "ab", "test",
  // Social sharing
  "share", "shared", "sharetype", "shared_from", "smid", "smtyp", "sr_share",
  // CMS / internal
  "mod", "action", "view", "format", "output", "render", "template", "layout",
]);

export function normalizeUrl(input: string): string {
  let raw = input;
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    raw = "https://" + raw;
  }

  raw = raw.replace(/^http:\/\//, "https://");

  const url = new URL(raw);

  url.hash = "";

  const keysToDelete: string[] = [];
  url.searchParams.forEach((_, key) => {
    if (STRIP_PARAMS.has(key.toLowerCase())) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => url.searchParams.delete(key));

  if (url.searchParams.get("amp") === "1") {
    url.searchParams.delete("amp");
  }

  url.pathname = url.pathname.replace(/\/amp\//, "/");

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}
