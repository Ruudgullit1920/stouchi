import type { ComponentChildren } from 'preact';

type Props = {
  children: ComponentChildren;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  type?: 'button' | 'submit';
  disabled?: boolean;
};

export function Button({ children, onClick, variant = 'primary', type = 'button', disabled = false }: Props) {
  /* jsdom's synthetic click dispatch still reaches a disabled button's listener, unlike real
     browsers; guard explicitly so `disabled` truly suppresses onClick. */
  return (
    <button
      type={type}
      class={`btn btn--${variant}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
