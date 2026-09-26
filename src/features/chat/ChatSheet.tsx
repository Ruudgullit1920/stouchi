/* The conversation with Aam Salah, inside the app's bottom sheet (which traps
 * focus and gives it back to + on close). Replies are announced through a
 * polite live region; the model's text is only ever rendered as text. */
import { ArrowRight, ArrowUp } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Store } from '../../data/store';
import { t, type StringKey } from '../../shared/i18n/t';
import { Bubble } from './Bubble';
import type { Chat } from './chat';
import { Chips } from './Chips';
import { ConfirmCard } from './ConfirmCard';
import type { Turn } from './history';
import { ReceiptCard } from './ReceiptCard';

export type ChatView = Pick<
  Chat,
  'turns' | 'busy' | 'offline' | 'send' | 'answerCard' | 'tapChip' | 'switchIncome'
>;

type Props = { chat: ChatView; store: Store; onOpenScreen: (screen: string) => void };

export const SCREENS = [
  'budget',
  'historique',
  'objectif',
  'pot:besoins',
  'pot:envies',
  'pot:epargne',
  'notifications',
  'reglages',
];
const SUGGESTIONS: StringKey[] = ['chat.suggest.1', 'chat.suggest.2', 'chat.suggest.3'];
const MAX_TEXT = 500;

function TurnView({ turn, chat, store, onOpenScreen }: Props & { turn: Turn }) {
  return (
    <>
      <Bubble turn={turn} />
      {turn.actions?.map(({ action }, i) => {
        if (action.type !== 'open') return <ReceiptCard key={i} action={action} />;
        const screen = String(action.screen);
        if (!SCREENS.includes(screen)) return null;
        return (
          <div key={i} class="openrow">
            <button type="button" class="openbtn" onClick={() => onOpenScreen(screen)}>
              {t('chat.open', { screen: t(`chat.screen.${screen}` as StringKey) })}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {turn.cards?.map((card) => (
        <ConfirmCard
          key={card.id}
          card={card}
          store={store}
          onAnswer={(yes) => void chat.answerCard(card.id, yes)}
          onSwitch={(to) => chat.switchIncome(card.id, to)}
        />
      ))}
    </>
  );
}

export function ChatSheet(props: Props) {
  const { chat } = props;
  const [text, setText] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const turns = chat.turns.value;
  const busy = chat.busy.value;
  const offline = chat.offline.value;

  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy]);

  const lastReply = [...turns].reverse().find((turn) => turn.role === 'assistant')?.text ?? '';
  const chips = turns.length ? (turns[turns.length - 1].chips ?? []) : SUGGESTIONS.map((k) => t(k));
  const submit = (e: Event) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    void chat.send(value);
  };

  return (
    <div class="chat">
      <p class={offline ? 'chat__status off' : 'chat__status'}>
        {t(offline ? 'chat.status.offline' : 'chat.status.online')}
      </p>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- it scrolls, so keyboard users must reach it (axe scrollable-region-focusable) */}
      <div class="chat-body" ref={body} role="region" aria-label={t('chat.thread')} tabIndex={0}>
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} {...props} />
        ))}
        {busy && (
          <div class="typing" role="img" aria-label={t('chat.typing')}>
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      <div class="chat__live" aria-live="polite">
        {lastReply}
      </div>
      <Chips items={chips} disabled={busy} onTap={(s) => void chat.tapChip(s)} />
      <form class="composer" onSubmit={submit}>
        <input
          value={text}
          maxLength={MAX_TEXT}
          autocomplete="off"
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.input')}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button type="submit" aria-label={t('chat.send')} disabled={busy}>
          <ArrowUp size={20} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
