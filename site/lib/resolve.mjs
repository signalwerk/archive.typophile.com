import { buildIndex, loadNode, paginate } from "./data.mjs";

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
      return doc ? { doc } : null;
    }
    default:
      return null;
  }
}

export { buildIndex, loadNode, paginate };
