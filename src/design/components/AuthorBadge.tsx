import { initials } from '../../shared/format';
import { t } from '../../shared/i18n/t';

/** Who logged a shared row (plan D9): initials in a small disc over the row
 * avatar's corner, read out as "Noté par Amira". */
export function AuthorBadge({ name }: { name: string }) {
  return (
    <span class="author-badge" role="img" aria-label={t('couple.author', { name })}>
      {initials(name) || '?'}
    </span>
  );
}
