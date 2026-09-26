import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import { t } from '../../shared/i18n/t';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  /** a modifier class for a sheet with its own layout (the chat) */
  className?: string;
};

/** Bottom sheet (spec §5.4): traps focus while open, Escape closes, focus returns to the opener. */
export function Sheet({ open, title, onClose, children, className }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  /* A new onClose each render must not re-run the effect: that would bounce focus to the first item. */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    (items()[0] ?? el).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = items();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) {
        e.preventDefault();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div class="sheet-layer">
      <button
        type="button"
        class="sheet-backdrop"
        tabIndex={-1}
        aria-label={t('action.close')}
        onClick={onClose}
      />
      <div
        ref={panel}
        class={className ? `sheet ${className}` : 'sheet'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div class="sheet__head">
          <h2 id={titleId} class="sheet__title">
            {title}
          </h2>
          <button type="button" class="icon-btn" aria-label={t('action.close')} onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
