'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { roomActions } from '@/lib/socket/client';
import { useSessionStore } from '@/lib/store/session';

export function NameEditor({ code, currentName }: { code: string; currentName: string }) {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) return setError(t('lobby.nameEmpty'));
    setSaving(true);
    setError(null);
    const res = await roomActions.rename(trimmed);
    setSaving(false);
    if (res.ok && res.data) {
      useSessionStore.getState().setSession(code, { name: res.data.name });
      useSessionStore.getState().setLastName(res.data.name);
      setEditing(false);
    } else if (res.error) {
      setError(res.error.message);
    }
  }

  if (!editing) {
    return (
      <button
        className="text-xs text-parchment/50 underline-offset-2 hover:text-parchment/80 hover:underline"
        onClick={() => {
          setValue(currentName);
          setError(null);
          setEditing(true);
        }}
      >
        {t('lobby.changeName')}
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={24}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <Button className="px-3 py-1 text-xs" onClick={save} disabled={saving}>
          {t('common.save')}
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(false)}>
          {t('common.cancel')}
        </Button>
      </div>
      {error && <p className="text-xs text-crimson">{error}</p>}
    </div>
  );
}
