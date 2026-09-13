import { deferred, Signal } from './signal.js';
import { SnapbackError, type Acquisition, type AcquisitionSnapshot, type Args,
  type MutationReceipt, type Operation, type OperationSnapshot, type QueryResource,
  type ResourceSnapshot } from './types.js';
import { queryKey } from './facts.js';
import { canonicalJson } from '../../../evaluator/src/value-runtime.js';

export const loading = <T>(): ResourceSnapshot<T> =>
  ({ data: undefined, status: 'loading', complete: false, fresh: false });

export class Resource<T> extends Signal<ResourceSnapshot<T>> implements QueryResource<T> {
  active = false;
  references?: Set<string>;
  projection?: string;
  acquisition?: { id: string; seq: number };
  readonly key: string;

  constructor(readonly op: string, readonly args: Args,
    private readonly acquire: () => Promise<ResourceSnapshot<T>>, demand: (active: boolean) => void) {
    super(loading<T>(), demand);
    this.key = queryKey(op, args);
  }

  refresh = (): Promise<ResourceSnapshot<T>> => this.acquire();

  override set(value: ResourceSnapshot<T>, notify = true): void {
    const previous = this.value;
    if (previous.status === value.status && previous.complete === value.complete
      && previous.fresh === value.fresh && previous.seq === value.seq && previous.next === value.next
      && previous.error?.code === value.error?.code && previous.error?.message === value.error?.message
      && (previous.data === value.data || canonicalJson(previous.data) === canonicalJson(value.data))
      && (previous.pending === value.pending || canonicalJson(previous.pending) === canonicalJson(value.pending))) return;
    super.set(value, notify);
  }
}

export class Intent<T> extends Signal<OperationSnapshot<T>> implements Operation<T> {
  private readonly admitted = deferred<void>();
  private readonly terminal = deferred<MutationReceipt<T>>();
  readonly durable = this.admitted.promise;
  private sealed = false;
  private readonly sealedResult = deferred<MutationReceipt<T>>();

  get settled(): Promise<MutationReceipt<T>> {
    return this.sealed ? this.sealedResult.promise : this.terminal.promise;
  }
  get isSealed(): boolean { return this.sealed; }

  constructor(readonly id: string, op: string, args: Args) {
    super({ id, op, args, status: 'persisting' });
  }

  admission(): void { this.admitted.resolve(); }
  finish(receipt: MutationReceipt<T>): void { if (!this.sealed) this.terminal.resolve(receipt); }
  fail(error: SnapbackError): void { this.admitted.reject(error); this.terminal.reject(error); }
  override set(value: OperationSnapshot<T>, notify = true): void { if (!this.sealed) super.set(value, notify); }

  seal(notify = true): boolean {
    if (this.sealed) return false;
    this.sealed = true;
    const error = new SnapbackError('S3_AUTH_CHANGED',
      'This operation belongs to a previous account session. Sign in to recover its current handle.');
    super.set({ id: this.id, op: '', args: Object.freeze({}), status: 'sealed', error }, notify);
    this.admitted.reject(error); this.terminal.reject(error); this.sealedResult.reject(error);
    return true;
  }
}

export class DatasetAcquisition extends Signal<AcquisitionSnapshot> implements Acquisition {
  private completion = deferred<AcquisitionSnapshot>();
  private completionSettled = false;
  private cycle = 0;
  private cancellation?: Promise<void>;

  get completed(): Promise<AcquisitionSnapshot> { return this.completion.promise; }

  constructor(readonly id: string, private readonly cancelRun: () => Promise<void>, private readonly resumeRun: () => void) {
    super({ id, status: 'acquiring', pages: 0, chains: 1 });
  }

  cancel = (): void => {
    if (this.getSnapshot().status === 'sealed' || this.getSnapshot().status === 'cancelled') return;
    this.cycle++;
    const error = new SnapbackError('S3_ACQUISITION_CANCELLED', 'The acquisition was cancelled. Call resume() to continue it.');
    this.set({ ...this.getSnapshot(), status: 'cancelled', error: undefined });
    if (this.completionSettled) this.replaceCompletion();
    this.completionSettled = true; this.completion.reject(error);
    this.cancellation = this.cancelRun();
  };

  resume = (): Promise<AcquisitionSnapshot> => {
    const status = this.getSnapshot().status;
    if (status === 'sealed' || status === 'ready' || status === 'acquiring') return this.completed;
    if (this.completionSettled) this.replaceCompletion();
    this.set({ ...this.getSnapshot(), status: 'acquiring', error: undefined });
    const cycle = ++this.cycle, start = () => {
      if (cycle === this.cycle && this.getSnapshot().status === 'acquiring') this.resumeRun();
    };
    if (this.cancellation) void this.cancellation.then(start); else start();
    return this.completed;
  };

  prepareAutomaticResume(): boolean {
    const status = this.getSnapshot().status;
    if (status === 'sealed' || status === 'cancelled' || status === 'error' && this.completionSettled) return false;
    if (status === 'ready') this.replaceCompletion();
    this.set({ ...this.getSnapshot(), status: 'acquiring', error: undefined });
    return true;
  }

  get awaitingRetry(): boolean { return this.getSnapshot().status === 'error' && !this.completionSettled; }

  finish(value: AcquisitionSnapshot): void {
    if (this.getSnapshot().status === 'sealed' || this.getSnapshot().status === 'cancelled') return;
    this.set(value); this.completionSettled = true; this.completion.resolve(value);
  }

  fail(error: SnapbackError): void {
    if (this.getSnapshot().status === 'sealed' || this.getSnapshot().status === 'cancelled') return;
    this.set({ ...this.getSnapshot(), status: 'error', error });
    this.completionSettled = true; this.completion.reject(error);
  }

  suspend(error: SnapbackError): void {
    if (this.getSnapshot().status === 'sealed' || this.getSnapshot().status === 'cancelled') return;
    this.set({ ...this.getSnapshot(), status: 'error', error });
  }

  seal(error: SnapbackError): void {
    this.cycle++;
    this.set({ ...this.getSnapshot(), status: 'sealed', error });
    if (this.completionSettled) this.replaceCompletion();
    this.completionSettled = true; this.completion.reject(error);
  }

  private replaceCompletion(): void {
    this.completion = deferred<AcquisitionSnapshot>(); this.completionSettled = false;
  }
}
