import { t } from '../../shared/i18n/t';
import { NAME_MAX, type StepProps } from './draft';

export function StepName({ draft, set }: StepProps) {
  return (
    <input
      class="bigin"
      aria-label={t('setup.name.placeholder')}
      placeholder={t('setup.name.placeholder')}
      value={draft.name}
      autocomplete="given-name"
      maxLength={NAME_MAX}
      enterKeyHint="next"
      onInput={(e) => set({ name: e.currentTarget.value })}
    />
  );
}
