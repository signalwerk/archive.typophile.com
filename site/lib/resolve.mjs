import { buildIndex, loadNode, loadUser, buildUserIndex, paginate, loadArchiveCounts } from "./data.mjs";

// Turn a route into exactly the data that route needs -- nothing more, so a
// thread page never pays for the full index being parsed.
//
// The index arrives as a function rather than a value, and only the routes
// that actually read it call it. A thread page is the whole point: it needs
// one YAML file, and used to wait on a summary of all sixty thousand first.
// Thread summaries reference their author by id; listings want a name.
function withAuthors(page) {
  const { byId } = buildUserIndex();
  return {
    ...page,
    items: page.items.map((t) => ({ ...t, authorName: byId.get(t.author)?.name ?? null })),
  };
}

export function resolve(route, getIndex) {
  switch (route.type) {
    case "about": {
      const index = getIndex();
      return { totals: index.totals, forums: index.forums.length, archives: loadArchiveCounts() };
    }
    case "index": {
      const index = getIndex();
      return {
        page: withAuthors(paginate(index.threads, route.page)),
        forums: index.forums,
        totals: index.totals,
      };
    }
    case "forum": {
      const index = getIndex();
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
    case "user": {
      const doc = loadUser(route.user);
      if (!doc) return null;
      // A member file records what they wrote, not the state of the thread it
      // landed in. The forum and the reply count come from the thread index,
      // so neither has to be duplicated into every member file.
      const byNode = new Map(getIndex().threads.map((t) => [t.id, t]));
      const withThread = (items) =>
        (items ?? []).map((it) => {
          const thread = byNode.get(it.node);
          return {
            ...it,
            forum: thread?.forum ?? it.forum ?? null,
            forumTitle: thread?.forumTitle ?? null,
            comments: thread?.comments ?? null,
          };
        });
      return {
        doc: { ...doc, posts: withThread(doc.posts), comments: withThread(doc.comments) },
      };
    }
    default:
      return null;
  }
}

export { buildIndex, loadNode, loadUser, buildUserIndex, paginate, loadArchiveCounts };
