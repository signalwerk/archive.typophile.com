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

// Drupal normally exposed a member's numeric id in `/user/<id>`, but it also
// allowed a profile to have a vanity path. Most vanity-only observations can
// only be kept under a stable string id. This one is different: the archived
// `/readthetype` profile's login form points at `user/15065`, and both forms
// use picture-15065.jpg, so the relation is explicit rather than inferred from
// a display name.
const KNOWN_VANITY_PROFILE_IDS = new Map([
  ["/readthetype", 15065],
]);

export function normaliseProfileHref(href) {
  let value = String(href ?? "").trim();
  if (!value) return null;

  // Some captures rewrote a vanity profile through the Wayback replay path,
  // for example `/web/20130816232648/http://typophile.com/readthetype`.
  // Recover the original Typophile URL before deciding whether it is numeric
  // or a genuine vanity path.
  const replay = /^(?:https?:\/\/web\.archive\.org)?\/web\/\d+(?:[a-z_]+)?\/(https?:\/\/.*)$/i.exec(value);
  if (replay) value = replay[1];

  const absolute = /^https?:\/\/(?:www\.)?typophile\.com(?::\d+)?(\/.*)?$/i.exec(value);
  if (absolute) value = absolute[1] || "/";
  value = value.split(/[?#]/, 1)[0];

  // Classic pages used `user/103`, whereas later pages used `/user/103`.
  // They identify the same account and must produce the same numeric id.
  if (!value.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    value = `/${value}`;
  }
  if (value.length > 1) value = value.replace(/\/+$/, "");
  return value || null;
}

function userFromLink($, link) {
  if (!link || link.length === 0) return { id: null, name: null, path: null };
  const href = normaliseProfileHref(link.attr("href"));
  // Matches both "/user/1258" and "http://typophile.com/user/1258".
  // A short-lived deployment prefixed the same Drupal route with `/cms`.
  const m = /^\/(?:cms\/)?user\/(\d+)$/.exec(href ?? "");
  const vanityId = KNOWN_VANITY_PROFILE_IDS.get(href?.toLowerCase()) ?? null;
  return {
    id: m ? Number(m[1]) : vanityId,
    name: (link.text() || "").trim().replace(/\s+/g, " ") || null,
    // Preserve a vanity path even when its numeric id is known. It is part of
    // the archived identity and can still be useful for old-link handling.
    path: m ? null : href,
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
  const m = /(?:Posted|Submitted) by\s+(.+?)(?:\s+(?:in|on)\b|\s*$)/i.exec(text.replace(/\s+/g, " "));
  const name = m?.[1]?.trim();
  return name && name.length < 80 ? name : null;
}

// The site shipped a shared placeholder for members with no picture; that is
// an absence, not an avatar, so it is not recorded as one.
const GENERIC_AVATAR = /(?:\/misc\/id_generic\.gif|\/sites\/default\/files\/avatars\/default\.jpg)(?:\?|$)/i;

function avatarFrom($, scope) {
  if (!scope || scope.length === 0) return null;
  const src = scope.find(".picture img, .user-picture img").first().attr("src");
  if (!src || GENERIC_AVATAR.test(src)) return null;
  // Stored absolute in some generations and relative in others; keep one form.
  const m = /(\/files\/pictures\/[^?#"'\s]+)/.exec(src);
  if (m) return m[1];

  // After the reboot Drupal exposed the migrated copies below its internal
  // files directory. They are the same pictures formerly served at /files,
  // which is the address the download and user pipelines index.
  const migrated = /\/sites\/default\/files\/(?:old-)?pictures\/([^?#"'\s]+)/.exec(src);
  return migrated ? `/files/pictures/${migrated[1]}` : src;
}

// No generation seen so far renders a score, but the hook is here so a
// generation that does can fill it in without touching the callers.
function findVotes($, scope) {
  const rating = scope.find(".rate-number-up-down-rating").first();
  if (rating.length > 0) {
    const n = /-?\d+/.exec(rating.text() || "");
    if (n) return Number(n[0]);
  }
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

// --- generation: drupal7 (seen after the 2016 reboot) ----------------------

function compactText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ") || null;
}

function displayedDate($, scope) {
  const dated = scope.find('[property~="dc:date"]').first();
  const text = compactText(dated.text()) ?? compactText(scope.find(".forum-posted-on").first().text());
  if (!text) return null;
  // RDF wraps the author and visible date in one span on ordinary node pages.
  // Keep only the human-readable date, matching the older generations'
  // date_raw field rather than storing the whole byline.
  return DATE_RE.exec(text)?.[0]?.trim() ?? text;
}

function modernMeta($, node) {
  const title =
    compactText($("h1.page-header").first().text()) ??
    compactText(node.find('[property~="dc:title"]').first().attr("content")) ??
    compactText($("title").first().text()?.replace(/\s*\|\s*Typophile\s*$/i, ""));

  // Advanced Forum kept the containing forum as a taxonomy-style link in
  // the opening post. Plain Drupal node templates sometimes omitted it, in
  // which case null is more honest than inferring a forum from other tags.
  const link = node.find('a[href^="/forum/"], a[href^="/forums/"]').first();
  const match = /\/(?:forum|forums)\/(\d+)/.exec(link.attr("href") || "");
  const forum = {
    id: match ? Number(match[1]) : null,
    title: match ? compactText(link.text()) : null,
  };
  return { title, forum };
}

function modernBodyHtml($, scope, comment = false) {
  const fieldName = comment ? ".field-name-comment-body" : ".field-name-body";
  const chunks = [];

  scope.find(fieldName).first().find('[property~="content:encoded"]').each((i, el) => {
    const html = cleanHtml($(el).html());
    if (html) chunks.push(html);
  });

  // Uploaded specimens can live beside rather than inside the body field.
  // Keep their rendered content so a successful archive download remains
  // visible after step 8 rewrites the image address.
  if (!comment) {
    scope.find(".field-name-field-file").first().find(".file > .content").each((i, el) => {
      const html = cleanHtml($(el).html());
      if (html) chunks.push(html);
    });
  }

  return cleanHtml(chunks.join("\n"));
}

function modernUser($, scope) {
  const link = scope.find(".submitted a.username, .author-name a.username").first();
  const linked = userFromLink($, link);
  const postedBy = /(?:^|\s)posted-by-(\d+)(?:\s|$)/.exec(scope.attr("class") || "");
  return {
    id: linked.id ?? (postedBy ? Number(postedBy[1]) : null),
    name: linked.name ?? nameFromByline(scope.find(".submitted").first().text()),
    path: linked.path,
  };
}

function parseModernEntry($, scope, { id, comment = false, optionalByline = false } = {}) {
  const issues = [];
  const user = modernUser($, scope);
  const dateRaw = displayedDate($, scope);
  const date = parseDate(dateRaw);
  const html = modernBodyHtml($, scope, comment);

  if (!optionalByline && !user.id) {
    issues.push({
      level: "warn", field: comment ? "comment.user_id" : "post.user_id",
      message: user.name ? `no user id (author ${JSON.stringify(user.name)})` : "no user id and no author name",
    });
  }
  if (!optionalByline && !dateRaw) {
    issues.push({ level: "warn", field: comment ? "comment.date" : "post.date", message: "no date in byline" });
  } else if (dateRaw && !date) {
    issues.push({
      level: "warn", field: comment ? "comment.date" : "post.date",
      message: `unparsable date ${JSON.stringify(dateRaw)}`,
    });
  }
  if (!html) {
    issues.push({
      level: comment ? "warn" : "error", field: comment ? "comment.html" : "post.html",
      message: comment ? "empty body" : "empty post body",
    });
  }

  return {
    entry: {
      id, user_id: user.id, user_name: user.name, user_path: user.path,
      user_image: avatarFrom($, scope), date_raw: dateRaw, date,
      votes: findVotes($, scope), html,
    },
    issues,
  };
}

const drupal7 = {
  id: "drupal7",
  description: "post-reboot Drupal 7; article.node or Advanced Forum div.forum-post",

  detect($) {
    return (
      $("article.node[id^='node-']").length > 0 ||
      $("div.node.forum-post[id^='post-']").length > 0
    );
  },

  parse($, ctx) {
    const issues = [];
    const node = $("article.node[id^='node-'], div.node.forum-post[id^='post-']").first();
    if (node.length === 0) {
      issues.push({ level: "error", field: "post", message: "no Drupal 7 node found" });
      return { ...modernMeta($, node), post: null, comments: [], issues };
    }

    const domId = /(?:node|post)-(\d+)/.exec(node.attr("id") || "");
    if (domId && Number(domId[1]) !== ctx.nodeId) {
      issues.push({
        level: "warn", field: "post.id",
        message: `page says node ${domId[1]} but URL says ${ctx.nodeId}`,
      });
    }

    // Wiki reference pages have no author or publication date in this
    // template. Their absent byline is intentional, not lost content.
    const optionalByline = node.hasClass("node-wiki") || node.hasClass("node-webform");
    const parsedPost = parseModernEntry($, node, { id: ctx.nodeId, optionalByline });
    issues.push(...parsedPost.issues);

    const comments = [];
    $("#comments div.comment, #forum-comments div.comment.forum-post").each((i, el) => {
      const comment = $(el);
      const id = commentIdFor($, comment, "comment");
      const ref = `comment ${id ?? `#${i}`}`;
      const parsed = parseModernEntry($, comment, { id, comment: true });
      if (id === null) {
        issues.push({ level: "warn", field: "comment.id", ref, message: "no comment id" });
      }
      for (const issue of parsed.issues) issues.push({ ...issue, ref });
      comments.push(parsed.entry);
    });

    return {
      ...modernMeta($, node),
      post: parsedPost.entry,
      comments,
      issues,
    };
  },
};

// --- generation: sidebars (seen 2015) --------------------------------------

const sidebars = {
  id: "sidebars",
  description: "pre-outage design; div#node-<id>, .userinfo/.content-head, #comments",

  detect($) {
    const bodyClasses = ($("body").attr("class") || "").split(/\s+/);
    return (
      bodyClasses.includes("sidebars") ||
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
export const GENERATIONS = [drupal7, sidebars, classic];

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
