/**
 * SSRF guard: agents pass URLs taken from untrusted web content, so the
 * fetch tools must refuse anything that resolves to local or internal
 * infrastructure (cloud metadata endpoints, loopback services, LAN hosts).
 *
 * This checks literal IPs and well-known local hostnames. It does not
 * resolve DNS, so a public hostname pointing at a private IP is not caught.
 */

const LOCAL_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function parseIpv4(host: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const octets = host.split(".").map(Number);
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateIpv6(host: string): boolean {
  // URL.hostname wraps IPv6 in brackets: "[::1]"
  const ip = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (ip === "::" || ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  if (ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  // IPv4-mapped, dotted (::ffff:192.168.0.1) or hex as WHATWG URL
  // normalizes it (::ffff:c0a8:1)
  const mappedDotted = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedDotted) {
    const octets = parseIpv4(mappedDotted[1]);
    return octets ? isPrivateIpv4(octets) : true;
  }
  const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  }
  return false;
}

/**
 * Returns a human-readable reason if the URL must not be fetched, or null if it's allowed.
 */
export function blockedUrlReason(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "not a valid URL";
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `unsupported protocol "${url.protocol}"`;
  }

  // WHATWG URL normalizes alternate IPv4 notations (decimal, octal, hex)
  // to dotted-quad, so checking the parsed hostname covers those too.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  if (host === "" || host === "localhost" || LOCAL_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s))) {
    return `"${host}" is a local hostname`;
  }

  const octets = parseIpv4(host);
  if (octets && isPrivateIpv4(octets)) {
    return `${host} is a private or reserved IP address`;
  }

  if (host.startsWith("[") && isPrivateIpv6(host)) {
    return `${host} is a private or reserved IPv6 address`;
  }

  return null;
}
