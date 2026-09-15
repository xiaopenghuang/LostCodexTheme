import { useLayoutEffect, useRef, useState } from 'react';

/** Cancel asynchronous UI work as soon as its document or panel scope changes. */
export function useOperation(scope: string) {
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    setBusy(false);
    return () => { controller.current?.abort(); };
  }, [scope]);
  function begin() {
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy(true);
    return controller.current.signal;
  }
  function finish(signal: AbortSignal) {
    if (!signal.aborted) setBusy(false);
  }
  return { busy, begin, finish };
}
