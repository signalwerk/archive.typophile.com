// Step 7 records the old site's shared placeholder as "no avatar". Step 12
// copies that original image separately so every missing picture uses it.
export function Avatar({ user, size = 44 }) {
  const style = { width: size, height: size };
  const src = user?.picture
    ? `/${user.picture.replace(/^users\//, "")}`
    : "/misc/id_generic.gif";

  return (
    <img
      className="avatar"
      style={style}
      src={src}
      alt=""
      loading="lazy"
      width={size}
      height={size}
    />
  );
}
