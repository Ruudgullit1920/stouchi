import { t } from '../../shared/i18n/t';
import { Button } from './Button';

type Props = { onRetry: () => void; body?: string };

export function ErrorState({ onRetry, body }: Props) {
  return (
    <div class="state" role="alert">
      <p class="state__title">{t('state.error.title')}</p>
      <p class="state__body">{body ?? t('state.error.body')}</p>
      <Button onClick={onRetry}>{t('action.retry')}</Button>
    </div>
  );
}
