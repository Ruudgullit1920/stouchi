import type { ComponentChildren, ComponentType } from 'preact';
import type { Mil } from '../../shared/money';
import { Icon3D } from '../i3d';
import { Amount, HIDDEN } from './Amount';
import { AuthorBadge } from './AuthorBadge';

type Props = {
  icon: ComponentType<{ size?: number | string }>;
  /** the 3D icon (src/design/i3d); it sits on a neutral disc and wins over icon */
  img?: string;
  /** avatar background, a pot colour token such as var(--need) */
  tint: string;
  /** plain text, or text with <mark>s from a search */
  title: ComponentChildren;
  subtitle?: string;
  mil: Mil;
  sign?: boolean;
  /** hide the amount (the eye on Budget) */
  hidden?: boolean;
  /** couple mode: who logged this shared row (plan D9) */
  author?: string | null;
  onClick?: () => void;
};

/** Spec §5.4 ledger row: 44 px round avatar, title, subtitle, right-aligned amount. */
export function LedgerRow({
  icon: Icon,
  img,
  tint,
  title,
  subtitle,
  mil,
  sign = false,
  hidden = false,
  author,
  onClick,
}: Props) {
  const avatar = img ? (
    <span class="ledger-row__avatar ledger-row__avatar--3d" aria-hidden="true">
      <Icon3D src={img} />
    </span>
  ) : (
    <span class="ledger-row__avatar" style={{ background: tint }} aria-hidden="true">
      <Icon size={20} />
    </span>
  );
  return (
    <button type="button" class="ledger-row" onClick={onClick}>
      {author ? (
        <span class="ledger-row__lead">
          {avatar}
          <AuthorBadge name={author} />
        </span>
      ) : (
        avatar
      )}
      <span class="ledger-row__text">
        <span class="ledger-row__title">{title}</span>
        {subtitle && <span class="ledger-row__sub">{subtitle}</span>}
      </span>
      {hidden ? (
        <span class="amount num ledger-row__amount">{HIDDEN}</span>
      ) : (
        <Amount mil={mil} sign={sign} class="ledger-row__amount" />
      )}
    </button>
  );
}
