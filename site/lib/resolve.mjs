import { buildIndex, loadNode, loadUser, buildUserIndex, paginate } from "./data.mjs";

// Turn a route into exactly the data that route needs -- nothing more, so a
// thread page never pays for the full index being parsed.
export function resolve(route, index) {
  switch (route.type) {
    case "index":
      return {
        page: paginate(index.threads, route.page),
        forums: index.forums,
        totals: index.totals,
      };
    case "forum": {
      const forum = index.forums.find((f) => f.id === route.forum);
      if (!forum) return null;
      const threads = index.threads.filter((t) => t.forum === route.forum);
      return { forum, page: paginate(threads, route.page), total: threads.length };
    }
    case "thread": {
      const doc = loadNode(route.node);
      if (!doc) return null;
      // Bylines show each member's avatar; look them up once per thread rather
      // than opening a user file per post.
      const { byId } = buildUserIndex();
      const pictures = {};
      for (const e of [doc.post, ...(doc.comments ?? [])]) {
        if (!e?.user_id || pictures[e.user_id] !== undefined) continue;
        pictures[e.user_id] = byId.get(e.user_id)?.picture ?? null;
      }
      return { doc, pictures };
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
