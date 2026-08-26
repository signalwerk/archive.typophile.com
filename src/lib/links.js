// Rewrite links that point at pages we recovered, so a thread from 2004 links
// to our copy instead of a dead host.
//
// Only the href is touched. The link text, the title attribute and every other
// attribute are left exactly as they were -- the point is to make the archive
// navigable, not to edit what people wrote.
//
// A link is only rewritten when we actually hold that node or member. Anything
// else keeps its original href and stays honestly dead.

// The <a> tags, and the href inside one of them.
const A_TAG = /<a\b[^>]*>/gi;
const HREF = /(\bhref\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

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

// Work out whether a href points at one of our pages.
export function internalTarget(rawHref) {
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
  const pathname = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
  const query = queryAt === -1 ? "" : withoutHash.slice(queryAt + 1);

  // /node/123, /cms/node/123, and the same for members.
  let m = /^\/(?:cms\/)?(node|user)\/(\d+)(?:\/.*)?$/i.exec(pathname);
  if (m) return { type: m[1].toLowerCase(), id: Number(m[2]), hash };

  // Drupal without clean URLs: index.php?q=node/123
  m = /(?:^|&)q=\/?(node|user)\/(\d+)/i.exec(query);
  if (m) return { type: m[1].toLowerCase(), id: Number(m[2]), hash };

  return null;
}

// `have` answers whether we hold a given node or member.
export function rewriteLinks(html, have) {
  if (!html) return { html, stats: { links: 0, rewritten: 0, internal: 0, missing: [] } };

  const stats = { links: 0, rewritten: 0, internal: 0, missing: [] };

  const out = String(html).replace(A_TAG, (tag) =>
    tag.replace(HREF, (match, prefix, _whole, dq, sq, uq) => {
      stats.links++;
      const raw = dq ?? sq ?? uq ?? "";
      const target = internalTarget(raw);
      if (!target) return match;

      stats.internal++;
      if (!have(target.type, target.id)) {
        stats.missing.push(`${target.type}/${target.id}`);
        return match;
      }

      stats.rewritten++;
      const quote = sq !== undefined ? "'" : '"';
      return `${prefix}${quote}/${target.type}/${target.id}/${target.hash}${quote}`;
    })
  );

  return { html: out, stats };
}
