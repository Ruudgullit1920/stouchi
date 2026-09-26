import { useEffect, useRef } from 'preact/hooks';

export interface ToastData {
  /** a new id restarts the timer, even for the same message */
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

type Props = { toast: ToastData | null; onDismiss: () => void; duration?: number };

/** The live region stays mounted so screen readers announce each new toast (spec §5.6). */
export function Toast({ toast, onDismiss, duration = 6000 }: Props) {
  /* A new onDismiss each render, or a new-but-same-id toast object, must not restart the
     timer: key the effect on the id itself and read the latest callback from a ref,
     the same pattern as Sheet's close ref. */
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dismiss.current(), duration);
    return () => clearTimeout(timer);
  }, [toast?.id, duration]);

  return (
    <div class="toast-region" role="status" aria-live="polite">
      {toast && (
        <div class="toast">
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              type="button"
              class="toast__action"
              onClick={() => {
                toast.onAction?.();
                onDismiss();
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
