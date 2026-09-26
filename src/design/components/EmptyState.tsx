import type { ComponentChildren } from 'preact';

type Props = { title: string; body?: string; action?: ComponentChildren };

export function EmptyState({ title, body, action }: Props) {
  return (
    <div class="state">
      <p class="state__title">{title}</p>
      {body && <p class="state__body">{body}</p>}
      {action}
    </div>
  );
}
