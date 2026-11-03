import { useEffect, useState } from 'react';
export function useRetryCountdown(retryAt: number | null) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      const value = Math.max(0, Math.ceil(((retryAt || 0) - Date.now()) / 1000));
      setSeconds(value);
      if (value) timer = setTimeout(tick, 1000);
    }
    tick();
    return () => clearTimeout(timer);
  }, [retryAt]);
  return seconds;
}
export const retryLabel = (seconds: number) =>
  seconds ? `Retry in ${seconds >= 60 ? `${Math.ceil(seconds / 60)}m` : `${seconds}s`}` : 'Retry';
