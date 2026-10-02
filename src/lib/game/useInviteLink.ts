import { useCallback, useEffect, useRef, useState } from 'react';

/** Share the current room and clear transient feedback on navigation/unmount. */
export function useInviteLink(code: string, duration = 1800) {
  const [copied, setCopied] = useState(false);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setCopied(false);
    return () => { generation.current++; clearTimeout(timer.current); };
  }, [code]);
  const copyInvite = useCallback(async () => {
    const current = generation.current;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${code}`);
      if (current !== generation.current) return;
      clearTimeout(timer.current);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), duration);
    } catch {
      if (current === generation.current) setCopied(false);
    }
  }, [code, duration]);
  return { copied, copyInvite };
}
