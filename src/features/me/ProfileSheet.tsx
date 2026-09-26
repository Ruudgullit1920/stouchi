import { BadgeCheck } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import type { Row } from '../../data/localdb';
import type { Store } from '../../data/store';
import { initials } from '../../shared/format';
import { t } from '../../shared/i18n/t';

const NAME_MAX = 40;

type Props = {
  store: Store;
  write: (table: 'profiles', row: Row) => Promise<void>;
  onDone: () => void;
};

/** Mon profil: the first name; the e-mail is shown, not edited. */
export function ProfileSheet({ store, write, onDone }: Props) {
  const [name, setName] = useState(store.profile.value?.first_name ?? '');
  const [error, setError] = useState(false);

  const save = async () => {
    const p = store.profile.value;
    const clean = name.trim();
    if (!clean) {
      setError(true);
      return;
    }
    if (!p) return;
    await write('profiles', { ...p, first_name: clean });
    onDone();
    showToast({ text: t('me.profile.saved') });
  };

  return (
    <div class="me-sheet">
      <div class="pv-av">
        <span class="avatar" aria-hidden="true">
          {initials(name) || '?'}
        </span>
      </div>
      <label class="field">
        <span>{t('me.profile.name')}</span>
        <input
          class="tin"
          value={name}
          maxLength={NAME_MAX}
          autocomplete="given-name"
          aria-invalid={error}
          onInput={(e) => {
            setName(e.currentTarget.value);
            setError(false);
          }}
        />
      </label>
      {error && (
        <p class="field-error" role="alert">
          {t('me.profile.nameError')}
        </p>
      )}
      <label class="field">
        <span>
          {t('me.profile.email')}
          <em class="verified" aria-hidden="true">
            <BadgeCheck aria-hidden="true" />
            {t('me.profile.verified')}
          </em>
        </span>
        <input class="tin" value={store.email.value ?? ''} readOnly />
      </label>
      <button type="button" class="cta" onClick={() => void save()}>
        {t('me.save')}
      </button>
    </div>
  );
}
