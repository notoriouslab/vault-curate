/**
 * Host-safety guards for user-supplied server URLs (embedding server,
 * AI curation server). Extracted from utils.ts so the logic is unit-testable
 * and so there is exactly ONE place that decides what a dangerous host looks
 * like — the 1.6.0 red-team pass found isLoopbackHost handling IPv4-mapped
 * IPv6 while isMetadataOrLinkLocal did not, and that drift was a filter
 * bypass (`http://[::ffff:169.254.169.254]/` sailed past validateServerUrl).
 */

export function validateServerUrl(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http/https server URLs are supported");
    }
    if (isMetadataOrLinkLocal(parsed.hostname)) {
        throw new Error("Refusing to target link-local / cloud-metadata endpoint");
    }
}

// Reject hosts a user has no legitimate reason to point at: cloud metadata
// endpoints (AWS/Azure/GCP at 169.254.169.254, Azure IMDS at 168.63.129.16,
// Alibaba at 100.100.100.200) plus IPv6 link-local + deprecated site-local.
// RFC 1918 private ranges (10/8, 172.16/12, 192.168/16) are NOT rejected —
// LAN-hosted Ollama is a real use case.
function isMetadataOrLinkLocal(rawHost: string): boolean {
    let host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
    const zoneIdx = host.indexOf("%");
    if (zoneIdx >= 0) host = host.slice(0, zoneIdx);

    if (isMetadataIPv4(host)) return true;
    if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;    // IPv6 link-local fe80::/10
    if (/^fe[c-f][0-9a-f]?:/.test(host)) return true;     // IPv6 site-local fec0::/10 (deprecated, still routable)

    // IPv4-mapped IPv6 (`::ffff:a9fe:a9fe` == 169.254.169.254): extract the
    // embedded IPv4 and re-check it against the same rules, exactly like
    // isLoopbackHost below does for loopback.
    if (host.includes(":")) {
        const groups = expandIPv6(host);
        if (
            groups &&
            groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
            groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff
        ) {
            const v4 = [
                (groups[6] >>> 8) & 0xff,
                groups[6] & 0xff,
                (groups[7] >>> 8) & 0xff,
                groups[7] & 0xff,
            ].join(".");
            return isMetadataIPv4(v4);
        }
    }
    return false;
}

function isMetadataIPv4(host: string): boolean {
    if (/^169\.254\./.test(host)) return true;             // IPv4 link-local /16
    if (host === "168.63.129.16") return true;             // Azure IMDS
    if (host === "100.100.100.200") return true;           // Alibaba metadata
    return false;
}

/**
 * Strict loopback host detection — catches the bypasses a literal allow-list
 * misses:
 *   - bare "0" resolves to 0.0.0.0 on Linux/macOS
 *   - 127.x.x.x covers the whole /8 loopback block
 *   - expanded IPv6 ("0:0:0:0:0:0:0:1") + zone-id ("::1%lo0")
 *   - bracketed IPv6 from URL.hostname
 *   - integer-encoded IPv4 (2130706433 = 127.0.0.1)
 *
 * Anything else is treated as remote so security warnings (HTTP+Bearer,
 * cleartext keys) fire correctly.
 */
export function isLoopbackHost(rawHost: string): boolean {
    if (!rawHost) return false;
    // URL.hostname strips brackets for some hosts but keeps them when a
    // zone-id is present; normalise either way.
    let host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
    // Strip zone-id suffix (e.g. "::1%lo0" → "::1") — it's a routing hint,
    // not part of the host identity.
    const zoneIdx = host.indexOf("%");
    if (zoneIdx >= 0) host = host.slice(0, zoneIdx);
    // Trailing dot in FQDN form.
    if (host.endsWith(".")) host = host.slice(0, -1);

    if (host === "localhost") return true;

    // IPv4 (dotted-quad + shorthand). 127/8 is the loopback block.
    if (/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.test(host)) {
        const parts = host.split(".").map(p => parseInt(p, 10));
        if (parts[0] === 127) return true;
        if (parts.every(p => p === 0)) return true;
        return false;
    }
    // Bare "0" or "127" → kernel completes to 0.0.0.0 / 127.0.0.1.
    if (host === "0" || host === "127") return true;
    // Integer-encoded IPv4: 2130706433 = 127.0.0.1.
    if (/^\d+$/.test(host)) {
        const n = parseInt(host, 10);
        if (!Number.isNaN(n) && n >= 0 && n <= 0xffffffff) {
            const a = (n >>> 24) & 0xff;
            if (a === 127 || n === 0) return true;
        }
        return false;
    }

    // IPv6 — accept both compressed (`::1`) and fully-expanded forms.
    if (host.includes(":")) {
        // Strip optional `::` short form by expanding to 8 groups.
        const groups = expandIPv6(host);
        if (!groups) return false;
        const allZeroExceptLast = groups.slice(0, 7).every(g => g === 0);
        if (allZeroExceptLast && groups[7] === 1) return true;
        // IPv4-mapped IPv6 (`::ffff:7f00:0001` == 127.0.0.1). The first 5
        // groups are zero, group 5 == 0xffff, and the last two encode the
        // IPv4 address with the high byte of group 6 being the first octet.
        if (
            groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
            groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff
        ) {
            const a = (groups[6] >>> 8) & 0xff;
            const allZeroV4 = groups[6] === 0 && groups[7] === 0;
            if (a === 127 || allZeroV4) return true;
        }
        return false;
    }

    return false;
}

function expandIPv6(host: string): number[] | null {
    // A dotted-IPv4 tail (`::ffff:169.254.169.254`) is legal IPv6 syntax;
    // fold it into the last two hex groups before the general parse.
    const v4Tail = host.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (v4Tail) {
        const octets = v4Tail.slice(2).map(p => parseInt(p, 10));
        if (octets.some(o => Number.isNaN(o) || o > 255)) return null;
        const hexTail = ((octets[0] << 8) | octets[1]).toString(16)
            + ":" + ((octets[2] << 8) | octets[3]).toString(16);
        host = v4Tail[1] + hexTail;
    }
    // Split on `::` once. Each side has its own colon-separated groups.
    const halves = host.split("::");
    if (halves.length > 2) return null;
    const parseSide = (s: string): number[] | null => {
        if (s === "") return [];
        const parts = s.split(":");
        const out: number[] = [];
        for (const p of parts) {
            if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
            out.push(parseInt(p, 16));
        }
        return out;
    };
    const head = parseSide(halves[0]);
    if (head === null) return null;
    if (halves.length === 1) return head.length === 8 ? head : null;
    const tail = parseSide(halves[1]);
    if (tail === null) return null;
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    const padding: number[] = Array<number>(fill).fill(0);
    return [...head, ...padding, ...tail];
}
