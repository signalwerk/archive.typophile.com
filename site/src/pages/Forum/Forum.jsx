import { Layout } from "../../components/Layout/Layout.jsx";
import { Crumbs } from "../../components/Crumbs/Crumbs.jsx";
import { Pager } from "../../components/Pager/Pager.jsx";
import { ThreadList } from "../../components/ThreadList/ThreadList.jsx";

export function ForumPage({ forum, threads, page, pages, total }) {
  return (
    <Layout wide>
      <div className="forum-head">
        <Crumbs trail={[{ label: "Typophile", href: "/" }, { label: "forum" }]} />
        <h1 className="h1">{forum.title || `Forum ${forum.id}`}</h1>
        <p className="lede">{total.toLocaleString("en-US")} threads</p>
      </div>
      <ThreadList threads={threads} />
      <Pager
        page={page}
        pages={pages}
        hrefFor={(n) => (n > 1 ? `/forum/${forum.id}/page/${n}/` : `/forum/${forum.id}/`)}
      />
    </Layout>
  );
}
