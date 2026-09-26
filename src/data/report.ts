/* Where a write the server refused is reported (spec §8.7: alert when sync
 * failures spike). The data layer only knows this hook; main.tsx points it at
 * the error tracker once it has loaded. Never any row content. */

export interface SyncFailure {
  table: string;
  kind: string;
  code: string;
}

let reporter: (failure: SyncFailure) => void = () => {};

export function setSyncFailureReporter(fn: (failure: SyncFailure) => void): void {
  reporter = fn;
}

export function reportSyncFailure(failure: SyncFailure): void {
  reporter(failure);
}
