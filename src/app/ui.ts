/* The app-wide overlays: one bottom sheet and one toast at a time. */
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import type { ToastData } from '../design/components/Toast';

export const sheet = signal<{ title: string; body: ComponentChildren; className?: string } | null>(null);
export const toast = signal<ToastData | null>(null);

export function openSheet(title: string, body: ComponentChildren, className?: string): void {
  sheet.value = { title, body, className };
}
export function closeSheet(): void {
  sheet.value = null;
}

let toastId = 0;
export function showToast({
  text,
  action,
}: {
  text: string;
  action?: { label: string; run: () => void };
}): void {
  toast.value = { id: ++toastId, message: text, actionLabel: action?.label, onAction: action?.run };
}
