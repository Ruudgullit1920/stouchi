import { Toast } from '../design/components/Toast';
import { toast } from './ui';

export function ToastHost() {
  return <Toast toast={toast.value} onDismiss={() => (toast.value = null)} />;
}
