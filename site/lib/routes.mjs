// One place that knows the URL shapes, used by both the dev server and the
// static build so a route can never render in dev but 404 in production.

export function parseRoute(pathname) {
  const p = pathname.replace(/\/+$/, "") || "/";

  if (p === "/") return { type: "index", page: 1 };

  let m = /^\/page\/(\d+)$/.exec(p);
  if (m) return { type: "index", page: Number(m[1]) };

  m = /^\/forum\/(\d+)$/.exec(p);
  if (m) return { type: "forum", forum: Number(m[1]), page: 1 };

  m = /^\/forum\/(\d+)\/page\/(\d+)$/.exec(p);
  if (m) return { type: "forum", forum: Number(m[1]), page: Number(m[2]) };

  m = /^\/node\/(\d+)$/.exec(p);
  if (m) return { type: "thread", node: Number(m[1]) };

  m = /^\/user\/(\d+)$/.exec(p);
  if (m) return { type: "user", user: Number(m[1]) };

  return null;
}

export function routeToPath(route) {
  switch (route.type) {
    case "index":
      return route.page > 1 ? `/page/${route.page}/` : "/";
    case "forum":
      return route.page > 1 ? `/forum/${route.forum}/page/${route.page}/` : `/forum/${route.forum}/`;
    case "thread":
      return `/node/${route.node}/`;
    case "user":
      return `/user/${route.user}/`;
    default:
      return "/";
  }
}
