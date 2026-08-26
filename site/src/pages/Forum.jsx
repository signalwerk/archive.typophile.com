import { Layout, Pager } from "../components/Layout.jsx";
import { ThreadList } from "../components/ThreadList.jsx";

export function ForumPage({ forum, threads, page, pages, total }) {
  return (
    <Layout wide>
      <div className="thread-head">
        <div className="crumbs">
          <a href="/">Typophile</a> &rsaquo; forum
        </div>
        <h1>{forum.title || `Forum ${forum.id}`}</h1>
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
