// Typophile ran on several designs over the years. The content survived the
// redesigns but the HTML around it did not, so each archived page has to be
// matched to a parser that understands the markup of its era.
//
// Adding a generation: give it a `detect` that is specific enough not to
// collide with the others, and a `parse` returning the shape below. Anything
// that matches no generation is reported in the log rather than guessed at.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Handles both era formats seen so far:
//   "24.Jan.2004 6.23pm"        (classic)
//   "20 Oct 2003 — 11:32am"     (sidebars)
const DATE_RE =
  /(\d{1,2})[.\s]+([A-Za-z]{3,})[.\s]+(\d{4})\s*(?:[—–-]\s*)?(?:(\d{1,2})[.:](\d{2})\s*(am|pm)?)?/i;

export function parseDate(raw) {
  if (!raw) return null;
  const m = DATE_RE.exec(raw.replace(/ /g, " ").trim());
  if (!m) return null;

  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!month) return null;

  const day = Number(m[1]);
  const year = Number(m[3]);
  let hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const meridian = m[6]?.toLowerCase();

  if (meridian === "pm" && hour !== 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const p = (n, w = 2) => String(n).padStart(w, "0");
  // No timezone is recorded anywhere on the page, so this stays naive rather
  // than pretending to be UTC.
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:00`;
}

// The byline puts the date in a bare text node after a <br>.
function textAfterFirstBr($, container) {
  const br = container.find("br").get(0);
  if (!br) return null;
  let out = "";
  for (let n = br.next; n; n = n.next) {
    if (n.type === "text") out += n.data;
    else if (n.type === "tag") break;
  }
  out = out.replace(/\s+/g, " ").trim();
  return out || null;
}

function userFromLink($, link) {
  if (!link || link.length === 0) return { id: null, name: null, path: null };
  const href = link.attr("href") || "";
  // Matches both "/user/1258" and "http://typophile.com/user/1258".
  const m = /\/user\/(\d+)/.exec(href);
  return {
    id: m ? Number(m[1]) : null,
    name: (link.text() || "").trim().replace(/\s+/g, " ") || null,
    // Some members had a vanity profile path (e.g. "/readthetype") instead of
    // a numeric one. There is no id to recover, but the name and the path are
    // still worth keeping.
    path: m ? null : href || null,
  };
}

// The author is the first link in a byline that is neither the comment
// permalink nor one of the forum/taxonomy links.
function authorLink($, scope) {
  if (!scope || scope.length === 0) return $();
  return scope
    .find("a")
    .filter((i, el) => {
      const href = el.attribs?.href || "";
      if (/#comment-/.test(href)) return false;
      if ($(el).closest("ul.links").length > 0) return false;
      return true;
    })
    .first();
}

// Guest posts have no link at all: "Posted by Guest in <forum>".
function nameFromByline(text) {
  if (!text) return null;
  const m = /Posted by\s+(.+?)(?:\s+in\b|\s*$)/i.exec(text.replace(/\s+/g, " "));
  const name = m?.[1]?.trim();
  return name && name.length < 80 ? name : null;
}

// The site shipped a shared placeholder for members with no picture; that is
// an absence, not an avatar, so it is not recorded as one.
const GENERIC_AVATAR = /\/misc\/id_generic\.gif(\?|$)/i;

function avatarFrom($, scope) {
  if (!scope || scope.length === 0) return null;
  const src = scope.find(".picture img").first().attr("src");
  if (!src || GENERIC_AVATAR.test(src)) return null;
  // Stored absolute in some generations and relative in others; keep one form.
  const m = /(\/files\/pictures\/[^?#"'\s]+)/.exec(src);
  return m ? m[1] : src;
}

// No generation seen so far renders a score, but the hook is here so a
// generation that does can fill it in without touching the callers.
function findVotes($, scope) {
  const el = scope.find('[class*="vote"],[class*="karma"],[class*="rating"],[class*="fivestar"]').first();
  if (el.length === 0) return null;
  const n = /-?\d+/.exec(el.text() || "");
  return n ? Number(n[0]) : null;
}

function cleanHtml(html) {
  if (html === null || html === undefined) return null;
  const trimmed = String(html).trim();
  return trimmed || null;
}

function commentIdFor($, comment, anchorPrefix) {
  // Preferred: the anchor immediately before the comment div.
  const prev = comment.prev();
  if (prev.length && /^a$/i.test(prev.get(0).tagName)) {
    const id = prev.attr("id") || prev.attr("name") || "";
    const m = new RegExp(`^${anchorPrefix}-?(\\d+)$`).exec(id);
    if (m) return Number(m[1]);
  }
  // Fallback: the permalink inside the comment.
  const link = comment.find('a[href*="#comment-"]').first();
  const m = /#comment-(\d+)/.exec(link.attr("href") || "");
  return m ? Number(m[1]) : null;
}

function commonMeta($) {
  const heading = $(".breadcrumb + h2").first();
  const title = (heading.text() || "").trim().replace(/\s+/g, " ") || null;

  // The last breadcrumb link is the forum the thread lives in.
  const crumbs = $(".breadcrumb a");
  let forum = { id: null, title: null };
  if (crumbs.length) {
    const last = crumbs.last();
    const m = /\/(?:forum|forums)\/(\d+)/.exec(last.attr("href") || "");
    forum = {
      id: m ? Number(m[1]) : null,
      title: (last.text() || "").trim().replace(/\s+/g, " ") || null,
    };
  }
  return { title, forum };
}

// --- generation: sidebars (seen 2015) --------------------------------------

const sidebars = {
  id: "sidebars",
  description: "final design; div#node-<id>, .userinfo/.content-head, #comments",

  detect($) {
    return (
      /\bsidebars\b/.test($("body").attr("class") || "") ||
      ($("div.node[id^='node-']").length > 0 && $(".content-head").length > 0)
    );
  },

  parse($, ctx) {
    const issues = [];
    const node = $("div.node").first();
    if (node.length === 0) {
      issues.push({ level: "error", field: "post", message: "no div.node found" });
      return { ...commonMeta($), post: null, comments: [], issues };
    }

    const domId = /node-(\d+)/.exec(node.attr("id") || "");
    if (domId && Number(domId[1]) !== ctx.nodeId) {
      issues.push({
        level: "warn", field: "post.id",
        message: `page says node ${domId[1]} but URL says ${ctx.nodeId}`,
      });
    }

    const submitted = node.find(".content-head .submitted").first();
    const user = userFromLink($, authorLink($, submitted));
    // The picture link carries the id even when the byline link is missing.
    const pictureUser = userFromLink($, node.find('.userinfo .picture a[href^="/user/"]').first());
    const userId = user.id ?? pictureUser.id;
    const userName = user.name ?? pictureUser.name ?? nameFromByline(submitted.text());
    const userPath = user.path ?? pictureUser.path ?? null;
    const userImage = avatarFrom($, node.find(".userinfo").first());

    const dateRaw = textAfterFirstBr($, submitted);
    const date = parseDate(dateRaw);
    if (!userId) {
      issues.push({
        level: "warn", field: "post.user_id",
        message: userName ? `no user id (author "${userName}")` : "no user id and no author name",
      });
    }
    if (!dateRaw) issues.push({ level: "warn", field: "post.date", message: "no date in byline" });
    else if (!date) issues.push({ level: "warn", field: "post.date", message: `unparsable date ${JSON.stringify(dateRaw)}` });

    const html = cleanHtml(node.children(".content").first().html());
    if (!html) issues.push({ level: "error", field: "post.html", message: "empty post body" });

    const comments = [];
    $("#comments div.comment").each((i, el) => {
      const c = $(el);
      const id = commentIdFor($, c, "comment");
      const ref = `comment ${id ?? `#${i}`}`;
      const info = c.find("> .info").first();
      const cu = userFromLink($, authorLink($, info));
      const cpic = userFromLink($, c.find('.infopic .picture a[href^="/user/"]').first());
      // Here the permalink's text is the date.
      const permalink = info.find('a[href*="#comment-"]').first();
      const cDateRaw = (permalink.text() || "").trim().replace(/\s+/g, " ") || textAfterFirstBr($, info);
      const cDate = parseDate(cDateRaw);
      const cHtml = cleanHtml(c.children(".content").first().html());

      const cName = cu.name ?? cpic.name;
      if (id === null) issues.push({ level: "warn", field: "comment.id", message: "no comment id", ref });
      if (!(cu.id ?? cpic.id)) {
        issues.push({
          level: "warn", field: "comment.user_id",
          message: cName ? `no user id (author "${cName}")` : "no user id and no author name",
          ref,
        });
      }
      if (!cDateRaw) issues.push({ level: "warn", field: "comment.date", message: "no date", ref });
      else if (!cDate) issues.push({ level: "warn", field: "comment.date", message: `unparsable date ${JSON.stringify(cDateRaw)}`, ref });
      if (!cHtml) issues.push({ level: "warn", field: "comment.html", message: "empty body", ref });

      comments.push({
        id, user_id: cu.id ?? cpic.id, user_name: cName,
        user_path: cu.path ?? cpic.path ?? null,
        user_image: avatarFrom($, c.find(".infopic").first()),
        date_raw: cDateRaw, date: cDate, votes: findVotes($, c), html: cHtml,
      });
    });

    return {
      ...commonMeta($),
      post: {
        id: ctx.nodeId, user_id: userId, user_name: userName, user_path: userPath,
        user_image: userImage,
        date_raw: dateRaw, date, votes: findVotes($, node), html,
      },
      comments,
      issues,
    };
  },
};

// --- generation: classic (seen 2004-2009) ----------------------------------

const classic = {
  id: "classic",
  description: "early design; #content-frame, div.node > .info, a#comment-<id> anchors",

  detect($) {
    return $("#content-frame").length > 0 || ($("div.node > .info").length > 0 && $(".content-head").length === 0);
  },

  parse($, ctx) {
    const issues = [];
    const node = $("div.node").first();
    if (node.length === 0) {
      issues.push({ level: "error", field: "post", message: "no div.node found" });
      return { ...commonMeta($), post: null, comments: [], issues };
    }

    const info = node.children(".info").first();
    const user = userFromLink($, authorLink($, info));
    const dateRaw = textAfterFirstBr($, info);
    const date = parseDate(dateRaw);

    if (!user.id) {
      issues.push({
        level: "warn", field: "post.user_id",
        message: user.name ? `no user id (author "${user.name}")` : "no user id and no author name",
      });
    }
    if (!dateRaw) issues.push({ level: "warn", field: "post.date", message: "no date in byline" });
    else if (!date) issues.push({ level: "warn", field: "post.date", message: `unparsable date ${JSON.stringify(dateRaw)}` });

    const html = cleanHtml(node.children(".content").first().html());
    if (!html) issues.push({ level: "error", field: "post.html", message: "empty post body" });

    // This design has no #comments wrapper; comments are siblings following
    // their own named anchor.
    const comments = [];
    $("div.comment").each((i, el) => {
      const c = $(el);
      const id = commentIdFor($, c, "comment");
      const ref = `comment ${id ?? i}`;
      const cinfo = c.children(".info").first();
      const cu = userFromLink($, authorLink($, cinfo));
      const cDateRaw = textAfterFirstBr($, cinfo);
      const cDate = parseDate(cDateRaw);
      const cHtml = cleanHtml(c.children(".content").first().html());

      if (id === null) issues.push({ level: "warn", field: "comment.id", message: "no comment id", ref });
      if (!cu.id) {
        issues.push({
          level: "warn", field: "comment.user_id",
          message: cu.name ? `no user id (author "${cu.name}")` : "no user id and no author name",
          ref,
        });
      }
      if (!cDateRaw) issues.push({ level: "warn", field: "comment.date", message: "no date", ref });
      else if (!cDate) issues.push({ level: "warn", field: "comment.date", message: `unparsable date ${JSON.stringify(cDateRaw)}`, ref });
      if (!cHtml) issues.push({ level: "warn", field: "comment.html", message: "empty body", ref });

      comments.push({
        id, user_id: cu.id, user_name: cu.name, user_path: cu.path,
        user_image: avatarFrom($, cinfo),
        date_raw: cDateRaw, date: cDate, votes: findVotes($, c), html: cHtml,
      });
    });

    return {
      ...commonMeta($),
      post: {
        id: ctx.nodeId, user_id: user.id, user_name: user.name, user_path: user.path,
        user_image: avatarFrom($, info),
        date_raw: dateRaw, date, votes: findVotes($, node), html,
      },
      comments,
      issues,
    };
  },
};

// Order matters: the most specific detector runs first.
export const GENERATIONS = [sidebars, classic];

export function detectGeneration($) {
  for (const generation of GENERATIONS) {
    try {
      if (generation.detect($)) return generation;
    } catch {
      // a broken page should not abort detection
    }
  }
  return null;
}
