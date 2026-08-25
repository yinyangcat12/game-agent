import { URL } from "node:url";

type CoverResult = { imageUrl: string; source: "provided" | "steam-cdn" | "page-meta" | "none" };

const cache = new Map<string, { expiresAt: number; result: CoverResult }>();
const cacheTtlMs = 30 * 60 * 1000;
const requestTimeoutMs = 8_000;

// Only fetch pages from well-known game stores/publishers. This endpoint is a
// metadata resolver, not a general-purpose server-side URL proxy.
const allowedHostSuffixes = [
  "steampowered.com", "steamstatic.com", "xbox.com", "microsoft.com", "playstation.com",
  "sonyentertainmentnetwork.com", "ubisoft.com", "epicgames.com", "nintendo.com",
  "nintendo.net", "gog.com", "ea.com", "blizzard.com", "battlenet.com", "riotgames.com",
  "apple.com", "google.com", "play.google.com",
];

function isAllowedHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return allowedHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function validHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function htmlDecode(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeEmbeddedUrl(value: string) {
  return htmlDecode(value)
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u0026/gi, "&");
}

function cleanImageUrl(value: unknown, pageUrl: URL) {
  if (typeof value !== "string") return "";
  const decoded = htmlDecode(value.trim());
  if (!decoded || decoded.startsWith("data:") || decoded.startsWith("javascript:")) return "";
  try {
    const image = new URL(decoded, pageUrl);
    return image.protocol === "http:" || image.protocol === "https:" ? image.toString() : "";
  } catch {
    return "";
  }
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function jsonLdImages(html: string, pageUrl: URL) {
  const images: string[] = [];
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const visit = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      const image = cleanImageUrl(normalizeEmbeddedUrl(value), pageUrl);
      if (image) images.push(image);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["image", "thumbnailUrl", "contentUrl"]) if (key in record) visit(record[key]);
    }
  };
  for (const script of scripts) {
    try { visit(JSON.parse(htmlDecode(script[1]))); } catch { /* Some stores embed invalid JSON-LD. */ }
  }
  return images;
}

function pageImageCandidates(html: string, pageUrl: URL) {
  const candidates = [
    metaContent(html, "og:image"), metaContent(html, "og:image:url"), metaContent(html, "twitter:image"),
    metaContent(html, "twitter:image:src"), metaContent(html, "image"), ...jsonLdImages(html, pageUrl),
  ];
  // Some stores (notably Xbox) put the actual artwork only in serialized page
  // state or ordinary img tags rather than standard social metadata.
  for (const match of html.matchAll(/(?:src|url|imageUrl|content)=["']([^"']+)["']/gi)) candidates.push(match[1]);
  for (const match of html.matchAll(/https?:\\?\/\\?\/[^"'\\\s]+/gi)) candidates.push(match[0]);
  return candidates
    .map((candidate) => cleanImageUrl(normalizeEmbeddedUrl(candidate), pageUrl))
    .filter((candidate) => candidate && !/(?:logo|icon|avatar|favicon|placeholder|default-image)/i.test(candidate))
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .sort((left, right) => {
      const score = (value: string) => {
        let points = 0;
        if (/(?:store-images\.s-microsoft\.com|gmedia\.playstation\.com|ubisoft\.com|epicgames\.com)/i.test(value)) points += 10;
        if (/(?:boxart|box-art|poster|pdpbanner|superhero|cover|game)/i.test(value)) points += 5;
        if (/\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(value)) points += 2;
        return points;
      };
      return score(right) - score(left);
    });
}

function steamCover(sourceUrl: URL, id: string) {
  const appMatch = sourceUrl.pathname.match(/\/app\/(\d+)/i);
  const numericId = appMatch?.[1] || (/^\d+$/.test(id) ? id : "");
  return numericId ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${numericId}/header.jpg` : "";
}

function directImage(sourceUrl: URL) {
  return /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(sourceUrl.pathname) ? sourceUrl.toString() : "";
}

export async function resolveGameCover(sourceUrlValue: string, providedImageUrl = "", id = ""): Promise<CoverResult> {
  const sourceUrl = validHttpUrl(sourceUrlValue);
  const provided = cleanImageUrl(providedImageUrl, sourceUrl || new URL("https://example.com"));
  if (provided) return { imageUrl: provided, source: "provided" };
  if (!sourceUrl) return { imageUrl: "", source: "none" };

  const cacheKey = `${sourceUrl.toString()}|${id}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  if (!isAllowedHost(sourceUrl.hostname)) return { imageUrl: "", source: "none" };
  const steam = steamCover(sourceUrl, id);
  if (steam) {
    const result = { imageUrl: steam, source: "steam-cdn" as const };
    cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, result });
    return result;
  }
  const direct = directImage(sourceUrl);
  if (direct) return { imageUrl: direct, source: "page-meta" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "AtlasPlay/1.0 cover-metadata-resolver", accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) return { imageUrl: "", source: "none" };
    const finalUrl = validHttpUrl(response.url);
    if (!finalUrl || !isAllowedHost(finalUrl.hostname)) return { imageUrl: "", source: "none" };
    const html = (await response.text()).slice(0, 2_000_000);
    const candidates = pageImageCandidates(html, finalUrl);
    for (const candidate of candidates) {
      const imageUrl = cleanImageUrl(candidate, finalUrl);
      if (imageUrl) {
        const result = { imageUrl, source: "page-meta" as const };
        cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, result });
        return result;
      }
    }
    const result = { imageUrl: "", source: "none" as const };
    cache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, result });
    return result;
  } catch {
    return { imageUrl: "", source: "none" };
  } finally {
    clearTimeout(timeout);
  }
}
