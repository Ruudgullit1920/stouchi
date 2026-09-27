import { Download, FileDown } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Store } from '../../data/store';
import { todayTunis } from '../../shared/dates';
import {
  EXPORT_CHOICES,
  exportFileName,
  exportRange,
  exportSummary,
  toCsv,
  type ExportChoice,
  type ExportInput,
  type ExportRange,
} from '../../shared/exportCsv';
import { t } from '../../shared/i18n/t';
import { formatMoney } from '../../shared/money';
import { HIDDEN, hideAmounts } from '../budget/hideAmounts';

type Props = {
  store: Store;
  fetchRows: (range: ExportRange) => Promise<ExportInput>;
  download: (name: string, csv: string) => void;
  onDone: () => void;
};

type Read = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: ExportInput };

/** Exporter mes données (plan D3): a period, what it holds, then one CSV. The
 * rows come from the server, so it needs a connection and says so. */
export function ExportSheet({ store, fetchRows, download, onDone }: Props) {
  const p = store.profile.value;
  const online = store.sync.value.online;
  const [choice, setChoice] = useState<ExportChoice>('year');
  const [read, setRead] = useState<Read>({ status: 'loading' });
  const asked = useRef(0);
  const range = p ? exportRange(choice, todayTunis(), p.payday) : null;

  const load = (r: ExportRange) => {
    const n = ++asked.current;
    setRead({ status: 'loading' });
    fetchRows(r).then(
      (rows) => n === asked.current && setRead({ status: 'ready', rows }),
      () => n === asked.current && setRead({ status: 'error' }),
    );
  };
  useEffect(() => {
    if (range && online) load(range);
  }, [choice, online]);
  if (!p || !range) return null;

  const save = () => {
    if (read.status !== 'ready') return;
    download(exportFileName(range, read.rows), toCsv(read.rows, range));
    onDone();
  };
  const sum = read.status === 'ready' ? exportSummary(read.rows, range) : null;

  return (
    <div class="me-sheet export">
      <div class="field">
        <span>{t('export.period')}</span>
      </div>
      <div class="chips">
        {EXPORT_CHOICES.map((c) => (
          <button key={c} type="button" aria-pressed={choice === c} onClick={() => setChoice(c)}>
            {t(`export.choice.${c}`)}
          </button>
        ))}
      </div>
      {online && (
        <div class="exp-sum" data-testid="export-sum" aria-live="polite">
          <FileDown aria-hidden="true" />
          <span>
            {sum
              ? t(sum.lines > 1 ? 'export.sum.many' : 'export.sum.one', {
                  n: sum.lines,
                  amount: hideAmounts.value ? HIDDEN : formatMoney(sum.spentMil),
                })
              : read.status === 'loading'
                ? t('export.loading')
                : '—'}
          </span>
        </div>
      )}
      {read.status === 'error' && online && (
        <p class="field-error" role="alert">
          {t('export.error')}
        </p>
      )}
      {read.status === 'error' && online ? (
        <button type="button" class="cta" onClick={() => load(range)}>
          {t('action.retry')}
        </button>
      ) : (
        <button type="button" class="cta" disabled={!online || read.status !== 'ready'} onClick={save}>
          <Download size={18} aria-hidden="true" />
          {t('export.go')}
        </button>
      )}
      <p class="hint center">{online ? t('export.hint') : t('export.offline')}</p>
    </div>
  );
}

/** Hands the file to the browser as a download. */
export function downloadCsv(name: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
