import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/Button';

export function AccountLogin({ loading, error, onLogin }: {
  loading: boolean;
  error?: string | null;
  onLogin: () => void;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-3 text-center">
      <Button className="h-14 w-full text-base sm:text-lg" disabled={loading} aria-busy={loading} onClick={onLogin}>
        {t('home.signIn')}
      </Button>
      {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
    </div>
  );
}
