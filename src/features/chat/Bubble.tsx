/* One line of the conversation. Text is always rendered as text (never as
 * HTML); in Aam Salah's replies, **bold** and amounts in TND are set in bold. */
import type { Turn } from './history';

const STRONG = /(\*\*.+?\*\*|\d[\d  ]*(?:[.,]\d+)?\s?(?:TND|DT|dinars?)\b)/g;

function strong(text: string) {
  return text
    .split(STRONG)
    .map((part, i) => (i % 2 ? <b key={i}>{part.replace(/^\*\*|\*\*$/g, '')}</b> : part));
}

export function Bubble({ turn }: { turn: Turn }) {
  if (turn.role === 'user') return <div class="msg me">{turn.text}</div>;
  if (turn.role === 'app') return <p class="msg note">{turn.text}</p>;
  return <div class="msg him">{strong(turn.text)}</div>;
}
