import { Layout, Pager, formatDate } from "../components/Layout.jsx";
import { Avatar } from "../components/Avatar.jsx";

export function UsersPage({ users, page, pages, total }) {
  return (
    <Layout wide>
      <div className="crumbs">
        <a href="/">Typophile</a> &rsaquo; members
      </div>
      <h1 className="page-title">Members</h1>
      <p className="lede">{total.toLocaleString("en-US")} members, most active first.</p>

      <ul className="members">
        {users.map((u) => (
          <li key={u.id}>
            <a href={`/user/${u.id}/`}>
              <Avatar user={u} size={36} />
              <span className="members__name">{u.name || `user ${u.id}`}</span>
            </a>
            <span className="members__meta">
              {u.posts + u.comments} posts
              {u.last ? <> · to {formatDate(u.last)}</> : null}
            </span>
          </li>
        ))}
      </ul>

      <Pager page={page} pages={pages} hrefFor={(n) => (n > 1 ? `/users/page/${n}/` : "/users/")} />
    </Layout>
  );
}
