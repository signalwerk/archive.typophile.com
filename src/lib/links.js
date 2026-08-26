// Work out what an address in an archived page refers to.
//
// Used by the cleaning pass to decide whether a link can be repointed at our
// own copy. Knowing nothing about markup, it deals only in URLs.

// Replay wrappers, in case the copy we stored came from a rewritten page.
const REPLAY_PREFIXES = [
  /^https?:\/\/web\.archive\.org\/web\/\d{4,14}[a-z_]*\/(.+)$/i,
  /^\/web\/\d{4,14}[a-z_]*\/(.+)$/i,
  /^https?:\/\/arquivo\.pt\/(?:wayback|noFrame\/replay)\/\d{4,14}[a-z_]*\/(.+)$/i,
];

const TYPOPHILE_HOST = /^https?:\/\/(?:www\.)?typophile\.com(?::\d+)?(\/.*)?$/i;

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

// Reduce an address to the path it names on the old site, unwrapping any
// replay wrapper on the way. Returns null for anything that points elsewhere.
export function sitePath(rawHref) {
  if (!rawHref) return null;
  let href = decodeEntities(String(rawHref).trim());
  if (!href || href.startsWith("#") || /^(mailto|javascript|data):/i.test(href)) return null;

  // Unwrap a replay URL, possibly nested.
  for (let i = 0; i < 3; i++) {
    const hit = REPLAY_PREFIXES.map((re) => re.exec(href)).find(Boolean);
    if (!hit) break;
    href = hit[1];
  }

  let rest;
  const absolute = TYPOPHILE_HOST.exec(href);
  if (absolute) rest = absolute[1] || "/";
  else if (href.startsWith("/")) rest = href;
  else return null; // another host, or a bare relative path we cannot trust

  const hashAt = rest.indexOf("#");
  const hash = hashAt === -1 ? "" : rest.slice(hashAt);
  const withoutHash = hashAt === -1 ? rest : rest.slice(0, hashAt);

  const queryAt = withoutHash.indexOf("?");
  return {
    pathname: queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt),
    query: queryAt === -1 ? "" : withoutHash.slice(queryAt + 1),
    hash,
  };
}

// Work out whether a href points at one of our pages.
export function internalTarget(rawHref) {
  const parts = sitePath(rawHref);
  if (!parts) return null;
  const { pathname, query, hash } = parts;

  // /node/123, /cms/node/123, and the same for members.
  let m = /^\/(?:cms\/)?(node|user)\/(\d+)(?:\/.*)?$/i.exec(pathname);
  if (m) return { type: m[1].toLowerCase(), id: Number(m[2]), hash };

  // Drupal without clean URLs: index.php?q=node/123
  m = /(?:^|&)q=\/?(node|user)\/(\d+)/i.exec(query);
  if (m) return { type: m[1].toLowerCase(), id: Number(m[2]), hash };

  return null;
}

