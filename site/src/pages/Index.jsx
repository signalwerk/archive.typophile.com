import { Layout, Pager } from "../components/Layout.jsx";
import { ThreadList } from "../components/ThreadList.jsx";

export function IndexPage({ threads, page, pages, forums, totals }) {
  return (
    <Layout wide>
      <p className="lede">
        {totals.threads.toLocaleString("en-US")} threads,{" "}
        {totals.comments.toLocaleString("en-US")} replies, recovered from web archives.
      </p>

      {page === 1 ? (
        <>
          <h2 id="forums" className="section-title">Forums</h2>
          <ul className="forums">
            {forums.map((f) => (
              <li key={f.id}>
                <a href={`/forum/${f.id}/`}>
                  {f.title || `forum ${f.id}`} <span className="count">{f.threads}</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <ThreadList threads={threads} />
      <Pager page={page} pages={pages} hrefFor={(n) => (n > 1 ? `/page/${n}/` : "/")} />
    </Layout>
  );
}
