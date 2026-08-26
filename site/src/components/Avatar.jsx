// Members who never uploaded a picture got a shared placeholder on the old
// site; step 7 records that as "no avatar", so here it becomes initials.
export function Avatar({ user, size = 44 }) {
  const style = { width: size, height: size };
  if (user?.picture) {
    return (
      <img
        className="avatar"
        style={style}
        src={`/${user.picture.replace(/^users\//, "")}`}
        alt=""
        loading="lazy"
        width={size}
        height={size}
      />
    );
  }
  const initials = (user?.name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span className="avatar avatar--empty" style={style} aria-hidden="true">
      {initials}
    </span>
  );
}
