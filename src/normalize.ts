const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "mc_cid", "mc_eid",
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
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
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
