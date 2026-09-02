import { renderToStaticMarkup } from "react-dom/server";
import { IndexPage } from "./pages/Index/Index.jsx";
import { ForumPage } from "./pages/Forum/Forum.jsx";
import { ThreadPage } from "./pages/Thread/Thread.jsx";
import { AboutPage } from "./pages/About/About.jsx";
import { UserPage } from "./pages/User/User.jsx";

// Pure rendering: the caller supplies the data, so the dev server and the
// static build produce identical output from identical input.
export function render(route, data) {
  switch (route.type) {
    case "about":
      return {
        title: "About — Typophile archive",
        html: renderToStaticMarkup(
          <AboutPage totals={data.totals} forums={data.forums} archives={data.archives} />
        ),
      };
    case "index": {
      const { items, page, pages } = data.page;
      return {
        title: "Typophile archive",
        html: renderToStaticMarkup(
          <IndexPage threads={items} page={page} pages={pages} forums={data.forums} totals={data.totals} />
        ),
      };
    }
    case "forum": {
      const { items, page, pages } = data.page;
      return {
        title: `${data.forum.title || `Forum ${data.forum.id}`} — Typophile archive`,
        html: renderToStaticMarkup(
          <ForumPage forum={data.forum} threads={items} page={page} pages={pages} total={data.total} />
        ),
      };
    }
    case "thread":
      return {
        title: `${data.doc.title || `node ${data.doc.node}`} — Typophile archive`,
        html: renderToStaticMarkup(<ThreadPage doc={data.doc} users={data.users} />),
      };
    case "user":
      return {
        title: `${data.doc.name || `user ${data.doc.user}`} — Typophile archive`,
        html: renderToStaticMarkup(<UserPage doc={data.doc} />),
      };
    default:
      return null;
  }
}
