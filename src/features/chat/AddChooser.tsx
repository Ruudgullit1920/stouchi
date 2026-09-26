/* The + speed dial (spec §4.2, prototype `.dial`): talk to Aam Salah, or type
 * the expense by hand. Small and in the main bundle; the chat itself is lazy. */
import { Calculator, ChevronRight, MessageCircle } from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../shared/i18n/t';
import './chooser.css';

type Props = { open: boolean; onChat: () => void; onManual: () => void; onClose: () => void };

export function AddChooser({ open, onChat, onManual, onClose }: Props) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    onClose();
  };
  return (
    <>
      <button
        type="button"
        class="dial-scrim"
        tabIndex={-1}
        aria-label={t('action.close')}
        onClick={onClose}
      />
      <div class="dial" role="group" aria-label={t('add.choose.label')}>
        <button ref={first} type="button" class="dial__item" onClick={onChat} onKeyDown={onKey}>
          <span class="dial__ic dial__ic--chat">
            <MessageCircle size={22} aria-hidden="true" />
          </span>
          <span class="dial__text">
            <b>{t('add.choose.chat')}</b>
            <span>{t('add.choose.chatHint')}</span>
          </span>
          <ChevronRight size={20} aria-hidden="true" class="dial__go" />
        </button>
        <button type="button" class="dial__item" onClick={onManual} onKeyDown={onKey}>
          <span class="dial__ic">
            <Calculator size={22} aria-hidden="true" />
          </span>
          <span class="dial__text">
            <b>{t('add.choose.manual')}</b>
            <span>{t('add.choose.manualHint')}</span>
          </span>
          <ChevronRight size={20} aria-hidden="true" class="dial__go" />
        </button>
      </div>
    </>
  );
}
