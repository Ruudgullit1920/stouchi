import { Sheet } from '../design/components/Sheet';
import { closeSheet, sheet } from './ui';

export function SheetHost() {
  const s = sheet.value;
  return (
    <Sheet open={s !== null} title={s?.title ?? ''} onClose={closeSheet} className={s?.className}>
      {s?.body}
    </Sheet>
  );
}
