import { Button } from '@/components/ui/Button';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';

export function AccountLogin({ loading, error, onLogin }: {
  loading: boolean;
  error?: string | null;
  onLogin: () => void;
}) {
  const t = useTranslations();
  // Sign-in navigates away; keep the button busy until the identity provider page loads.
  const [redirecting, setRedirecting] = useState(false);
  const busy = loading || redirecting;

  useEffect(() => {
    // Returning with the back button restores this page from bfcache, still busy.
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) setRedirecting(false); };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  return (
    <div className="space-y-3 text-center">
      <Button
        className="h-14 w-full text-base sm:text-lg"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          setRedirecting(true);
          onLogin();
        }}
      >
        {busy && (
          <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {busy ? t('home.signingIn') : t('home.signIn')}
      </Button>
      {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
    </div>
  );
}
