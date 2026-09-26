/* "Nouvelle version — Recharger" (spec §8.3): a new worker waits; the page
 * offers the reload and never reloads without the tap. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, updateReady, watchUpdates } from '../../../src/app/update';

type Fn = () => void;
class FakeWorker {
  state = 'installing';
  posted: unknown[] = [];
  private fns: Fn[] = [];
  postMessage(m: unknown) {
    this.posted.push(m);
  }
  addEventListener(_t: 'statechange', fn: Fn) {
    this.fns.push(fn);
  }
  become(state: string) {
    this.state = state;
    this.fns.forEach((f) => f());
  }
}
class FakeReg {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  private fns: Fn[] = [];
  addEventListener(_t: 'updatefound', fn: Fn) {
    this.fns.push(fn);
  }
  found(w: FakeWorker) {
    this.installing = w;
    this.fns.forEach((f) => f());
  }
}
class FakeContainer {
  constructor(public controller: object | null) {}
  private fns: Fn[] = [];
  addEventListener(_t: 'controllerchange', fn: Fn) {
    this.fns.push(fn);
  }
  change() {
    this.fns.forEach((f) => f());
  }
}

let reload: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  updateReady.value = false;
  reload = vi.fn<() => void>();
});

describe('watchUpdates', () => {
  it('a worker already waiting behind the current one is offered at once', () => {
    const reg = new FakeReg();
    reg.waiting = new FakeWorker();
    watchUpdates(reg, new FakeContainer({}), reload);
    expect(updateReady.value).toBe(true);
  });

  it('a new version installed while the page is open is offered', () => {
    const reg = new FakeReg();
    watchUpdates(reg, new FakeContainer({}), reload);
    const w = new FakeWorker();
    reg.found(w);
    expect(updateReady.value).toBe(false);
    w.become('installed');
    expect(updateReady.value).toBe(true);
  });

  it('the very first install offers nothing (no page is on an older version)', () => {
    const reg = new FakeReg();
    watchUpdates(reg, new FakeContainer(null), reload);
    const w = new FakeWorker();
    reg.found(w);
    w.become('installed');
    expect(updateReady.value).toBe(false);
  });

  it('Recharger tells the waiting worker to take over, then reloads once', () => {
    const reg = new FakeReg();
    const container = new FakeContainer({});
    reg.waiting = new FakeWorker();
    watchUpdates(reg, container, reload);
    applyUpdate();
    expect(reg.waiting.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(reload).not.toHaveBeenCalled();
    container.change();
    container.change();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('a worker taking over without the tap (another tab) never reloads this page', () => {
    const reg = new FakeReg();
    const container = new FakeContainer({});
    reg.waiting = new FakeWorker();
    watchUpdates(reg, container, reload);
    container.change();
    expect(reload).not.toHaveBeenCalled();
  });
});
