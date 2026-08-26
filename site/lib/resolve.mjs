import { buildIndex, loadNode, loadUser, buildUserIndex, paginate } from "./data.mjs";

// Turn a route into exactly the data that route needs -- nothing more, so a
// thread page never pays for the full index being parsed.
// Thread summaries reference their author by id; listings want a name.
function withAuthors(page) {
  const { byId } = buildUserIndex();
  return {
    ...page,
    items: page.items.map((t) => ({ ...t, authorName: byId.get(t.author)?.name ?? null })),
  };
}

export function resolve(route, index) {
  switch (route.type) {
    case "index":
      return {
        page: withAuthors(paginate(index.threads, route.page)),
        forums: index.forums,
        totals: index.totals,
      };
    case "forum": {
      const forum = index.forums.find((f) => f.id === route.forum);
      if (!forum) return null;
      const threads = index.threads.filter((t) => t.forum === route.forum);
      return { forum, page: withAuthors(paginate(threads, route.page)), total: threads.length };
    }
    case "thread": {
      const doc = loadNode(route.node);
      if (!doc) return null;
      // Entries carry only an id; resolve each participant once per thread
      // rather than opening a member file per post.
      const { byId } = buildUserIndex();
      const users = {};
      for (const e of [doc.post, ...(doc.comments ?? [])]) {
        if (e?.user == null || users[e.user] !== undefined) continue;
        const u = byId.get(e.user);
        users[e.user] = { id: e.user, name: u?.name ?? null, picture: u?.picture ?? null };
      }
      return { doc, users };
    }
    case "users": {
      const { users } = buildUserIndex();
      return { page: paginate(users, route.page), total: users.length };
    }
    case "user": {
      const doc = loadUser(route.user);
      return doc ? { doc } : null;
    }
    default:
      return null;
  }
}

export { buildIndex, loadNode, loadUser, buildUserIndex, paginate };
