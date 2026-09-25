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
  private activeRequest: AbortController | undefined;
  private destroyed = false;

  readonly pendingRecords = this.queue.asReadonly();
  readonly pendingCount = computed(() => this.pendingRecords().length);
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
    return this.pendingRecords().some((item) => item.id === entry.id) ? 'queued' : 'sent';
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
