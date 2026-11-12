import { useEffect, useState } from 'react';

// A short introduction, rather than a permanent animation on an idle screen.
export function BrandMark({
  staticSrc,
  animatedSrc,
}: {
  staticSrc: string;
  animatedSrc: string;
}) {
  const [playing, setPlaying] = useState(!document.hidden);
  useEffect(() => {
    const stop = () => setPlaying(false);
    const onVisibilityChange = () => {
      if (document.hidden) stop();
    };
    const timeout = window.setTimeout(stop, 10_000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
  return (
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet={staticSrc} />
      <img
        className="empty-mark"
        src={playing ? animatedSrc : staticSrc}
        alt=""
        width="160"
        height="160"
      />
    </picture>
  );
}
