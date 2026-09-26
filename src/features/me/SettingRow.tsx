import { ChevronRight, type LucideIcon } from 'lucide-preact';

export type Tone = 'save' | 'need' | 'want' | 'acc' | 'plain';

type RowProps = {
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  sub?: string;
  /** the sub-line is a change waiting for the next payday */
  pending?: boolean;
  value?: string;
  onClick?: () => void;
};

/** A settings row that opens something (the prototype's `srow`). */
export function SettingRow({ icon: Icon, tone = 'plain', title, sub, pending, value, onClick }: RowProps) {
  return (
    <button type="button" class="srow" onClick={onClick}>
      <span class={`ic tone-${tone}`}>
        <Icon aria-hidden="true" />
      </span>
      <span class="tx">
        <span class="t">{title}</span>
        {sub && <span class={pending ? 's pend' : 's'}>{sub}</span>}
      </span>
      <span class="a num">{value}</span>
      <ChevronRight class="chev" aria-hidden="true" />
    </button>
  );
}

type ToggleProps = {
  icon: LucideIcon;
  title: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
};

/** A settings row with a switch (the prototype's `trow`). */
export function ToggleRow({ icon: Icon, title, sub, on, onToggle }: ToggleProps) {
  return (
    <div class="srow tg">
      <span class="ic tone-plain">
        <Icon aria-hidden="true" />
      </span>
      <span class="tx">
        <span class="t">{title}</span>
        <span class="s">{sub}</span>
      </span>
      <button
        type="button"
        class={on ? 'sw on' : 'sw'}
        role="switch"
        aria-checked={on}
        aria-label={title}
        onClick={onToggle}
      />
    </div>
  );
}
