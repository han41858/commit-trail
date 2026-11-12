export function BrandMark({
  staticSrc,
  animatedSrc,
}: {
  staticSrc: string;
  animatedSrc: string;
}) {
  return (
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet={staticSrc} />
      <img
        className="empty-mark"
        src={animatedSrc}
        alt=""
        width="160"
        height="160"
      />
    </picture>
  );
}
