import { Check, Copy, Share2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import { t } from '../../shared/i18n/t';

type Props = {
  code: string;
  onDone: () => void;
};

const copy = (text: string): Promise<void> =>
  navigator.clipboard?.writeText(text).catch(() => undefined) ?? Promise.resolve();

/** Inviter mon partenaire (prototype `invite`): the code, to copy or share. */
export function InviteSheet({ code, onDone }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const share = () => {
    const text = t('couple.share.text', { code });
    if (typeof navigator.share === 'function') void navigator.share({ text }).catch(() => undefined);
    else void copy(text).then(() => showToast({ text: t('couple.share.copied') }));
  };

  return (
    <div class="me-sheet">
      <p class="hint">{t('couple.invite.lead')}</p>
      <div class="code num">{code}</div>
      <div class="grid2">
        <button
          type="button"
          class="btn2"
          onClick={() => {
            void copy(code);
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {t(copied ? 'couple.copied' : 'couple.copy')}
        </button>
        <button type="button" class="btn2" onClick={share}>
          <Share2 aria-hidden="true" />
          {t('couple.share')}
        </button>
      </div>
      <p class="hint center">{t('couple.invite.once')}</p>
      <button type="button" class="cta" onClick={onDone}>
        {t('couple.sent')}
      </button>
    </div>
  );
}
