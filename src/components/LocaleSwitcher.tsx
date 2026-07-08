'use client';

import { useTransition } from 'react';
import { useLocale } from 'use-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/utils/cn';

/** Compact zh/en toggle that preserves the current path. */
export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(next: string) {
    if (next === locale) return;
    startTransition(() => {
      // Replace keeps history clean; pathname is locale-agnostic here.
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-gold/30 bg-ink/40 p-0.5">
      {routing.locales.map((l) => (
        <button
          key={l}
          disabled={pending}
          onClick={() => switchTo(l)}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs transition-colors',
            l === locale ? 'bg-gold text-ink' : 'text-parchment/60 hover:text-parchment',
          )}
        >
          {l === 'zh' ? '中文' : 'EN'}
        </button>
      ))}
    </div>
  );
}
