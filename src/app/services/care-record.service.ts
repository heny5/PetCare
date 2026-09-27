import { Injectable, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { environment } from '../../environments/environment';
import { ConnectivityService } from './connectivity.service';

export interface CareRecord {
  id: string;
  petName: string;
  description: string;
  createdAt: string;
}

export interface PendingCareRecord extends CareRecord {
  queuedAt: string;
}

export type SaveResult = 'sent' | 'queued';

/** Persists every record before sending it and retries until the API accepts it. */
@Injectable({ providedIn: 'root' })
export class CareRecordService implements OnDestroy {
  private static readonly queueKey = 'petcare.pending-care-records';
  private static readonly retryDelayMs = 15_000;
  private readonly connectivity = inject(ConnectivityService);
  private readonly queue = signal(this.readQueue());
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTask: Promise<void> | undefined;
  private loadTask: Promise<void> | undefined;
  private activeRequest: AbortController | undefined;
  private destroyed = false;

  readonly pendingRecords = this.queue.asReadonly();
  readonly pendingCount = computed(() => this.pendingRecords().length);
  readonly serverRecords = signal<CareRecord[]>([]);
  readonly isLoadingRecords = signal(false);
  readonly recordsLoadError = signal(false);
  readonly isSynchronizing = signal(false);
  readonly syncError = signal(false);
  readonly migrationError = signal(false);
  readonly lastSyncedAt = signal('');

  constructor() {
    this.migrateLegacyQueue();
    effect(() => {
      const online = this.connectivity.isOnline();
      untracked(() => {
        this.clearRetry();
        if (online) {
          void this.syncPending();
        } else {
          this.activeRequest?.abort();
        }
      });
    });
  }

  async save(record: Omit<CareRecord, 'id' | 'createdAt'>): Promise<SaveResult> {
    const entry: PendingCareRecord = {
      ...record,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      queuedAt: new Date().toISOString(),
    };

    // Keep the record even if the page closes while the request is in flight.
    this.writeQueue([...this.readQueue(), entry]);
    await this.syncPending();
    const result = this.pendingRecords().some((item) => item.id === entry.id) ? 'queued' : 'sent';
    if (result === 'sent') {
      void this.loadRecords();
    }
    return result;
  }

  loadRecords(): Promise<void> {
    if (this.loadTask) {
      return this.loadTask;
    }
    if (this.destroyed) {
      return Promise.resolve();
    }
    if (!this.connectivity.isOnline()) {
      this.recordsLoadError.set(true);
      return Promise.resolve();
    }

    this.isLoadingRecords.set(true);
    this.recordsLoadError.set(false);
    this.loadTask = this.fetchRecords().finally(() => {
      this.loadTask = undefined;
      this.isLoadingRecords.set(false);
    });
    return this.loadTask;
  }

  syncPending(): Promise<void> {
    if (this.syncTask) {
      return this.syncTask;
    }
    if (this.destroyed || !this.connectivity.isOnline() || !this.pendingCount()) {
      return Promise.resolve();
    }

    this.clearRetry();
    this.isSynchronizing.set(true);
    this.syncError.set(false);
    this.syncTask = this.drainQueue().finally(() => {
      this.syncTask = undefined;
      this.isSynchronizing.set(false);
      this.scheduleRetry();
    });
    return this.syncTask;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearRetry();
    this.activeRequest?.abort();
  }

  private async drainQueue(): Promise<void> {
    // Read again after each response to include records added during an active send.
    while (!this.destroyed && this.connectivity.isOnline() && this.pendingCount()) {
      const record = this.pendingRecords()[0];
      try {
        await this.sendToServer(record);
        this.writeQueue(this.readQueue().filter((item) => item.id !== record.id));
        this.lastSyncedAt.set(new Date().toISOString());
      } catch {
        this.syncError.set(this.connectivity.isOnline());
        break;
      }
    }
  }

  private async sendToServer(record: CareRecord): Promise<void> {
    const controller = new AbortController();
    this.activeRequest = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(environment.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`The server rejected the care record (${response.status}).`);
      }
    } finally {
      window.clearTimeout(timeout);
      this.activeRequest = undefined;
    }
  }

  private async fetchRecords(): Promise<void> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(environment.apiUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`The server could not return care records (${response.status}).`);
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload) || !payload.every(isCareRecord)) {
        throw new Error('The server returned an invalid care-record list.');
      }
      this.serverRecords.set(
        [...payload].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      );
    } catch {
      this.recordsLoadError.set(true);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private readQueue(): PendingCareRecord[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(CareRecordService.queueKey) ?? '[]');
      return Array.isArray(value) ? value as PendingCareRecord[] : [];
    } catch {
      return [];
    }
  }

  private writeQueue(queue: PendingCareRecord[]): void {
    localStorage.setItem(CareRecordService.queueKey, JSON.stringify(queue));
    this.queue.set(queue);
  }

  private migrateLegacyQueue(): void {
    try {
      const value = localStorage.getItem('petcare-pendientes');
      if (value === null) {
        return;
      }
      const legacy: unknown = JSON.parse(value);
      if (!Array.isArray(legacy)) {
        throw new Error('Invalid legacy queue');
      }
      const queue = this.readQueue();
      const ids = new Set(queue.map((record) => record.id));
      const remaining: unknown[] = [];
      for (const item of legacy) {
        if (
          !item || typeof item.id !== 'string' || !item.id ||
          typeof item.tipo !== 'string' ||
          typeof item.detalle !== 'string' || !item.detalle ||
          typeof item.fecha !== 'string' || !item.fecha
        ) {
          remaining.push(item);
          continue;
        }
        if (!ids.has(item.id)) {
          queue.push({
            id: item.id,
            petName: item.tipo.replace(/^Cuidado de\s+/, '').trim() || 'Luna',
            description: item.detalle,
            createdAt: item.fecha,
            queuedAt: item.fecha,
          });
          ids.add(item.id);
        }
      }
      // Remove the old copy only after the merged queue is stored successfully.
      this.writeQueue(queue);
      if (remaining.length) {
        localStorage.setItem('petcare-pendientes', JSON.stringify(remaining));
        this.migrationError.set(true);
      } else {
        localStorage.removeItem('petcare-pendientes');
      }
    } catch {
      // Preserve the original queue if conversion or storage fails.
      this.migrationError.set(true);
    }
  }

  private scheduleRetry(): void {
    this.clearRetry();
    if (this.destroyed || !this.connectivity.isOnline() || !this.pendingCount()) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.syncPending();
    }, CareRecordService.retryDelayMs);
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }
}

function isCareRecord(value: unknown): value is CareRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<CareRecord>;
  return typeof record.id === 'string' &&
    typeof record.petName === 'string' &&
    typeof record.description === 'string' &&
    typeof record.createdAt === 'string';
}
