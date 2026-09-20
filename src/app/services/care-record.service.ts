import { Injectable, signal } from '@angular/core';
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

/** Stores unsent care records in localStorage and sends them when connection returns. */
@Injectable({ providedIn: 'root' })
export class CareRecordService {
  private static readonly queueKey = 'petcare.pending-care-records';
  private static readonly retryDelayMs = 15_000;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  readonly pendingCount = signal(this.readQueue().length);
  readonly isSynchronizing = signal(false);
  readonly syncError = signal(false);

  constructor(private readonly connectivity: ConnectivityService) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.requestSync());
    }

    if (this.connectivity.isOnline()) {
      this.requestSync();
    }
  }

  async save(record: Omit<CareRecord, 'id' | 'createdAt'>): Promise<SaveResult> {
    const entry: CareRecord = {
      ...record,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    if (!this.connectivity.isOnline()) {
      this.enqueue(entry);
      return 'queued';
    }

    try {
      await this.sendToServer(entry);
      this.requestSync();
      return 'sent';
    } catch {
      this.enqueue(entry);
      this.scheduleRetry();
      return 'queued';
    }
  }

  async syncPending(): Promise<void> {
    if (!this.connectivity.isOnline() || this.isSynchronizing()) {
      return;
    }

    const queue = this.readQueue();
    if (!queue.length) {
      return;
    }

    this.isSynchronizing.set(true);
    try {
      const sentIds = new Set<string>();
      for (let index = 0; index < queue.length; index += 1) {
        try {
          await this.sendToServer(queue[index]);
          sentIds.add(queue[index].id);
        } catch {
          this.syncError.set(true);
          break;
        }
      }
      const remaining = this.readQueue().filter((entry) => !sentIds.has(entry.id));
      this.writeQueue(remaining);
      this.syncError.set(remaining.length > 0);
    } finally {
      this.isSynchronizing.set(false);
      this.scheduleRetry();
    }
  }

  private async sendToServer(record: CareRecord): Promise<void> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    let response: Response;

    try {
      response = await fetch(environment.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`The server rejected the care record (${response.status}).`);
    }
  }

  private enqueue(record: CareRecord): void {
    const queue = this.readQueue();
    queue.push({ ...record, queuedAt: new Date().toISOString() });
    this.writeQueue(queue);
  }

  private readQueue(): PendingCareRecord[] {
    try {
      const value = localStorage.getItem(CareRecordService.queueKey);
      return value ? JSON.parse(value) as PendingCareRecord[] : [];
    } catch {
      return [];
    }
  }

  private writeQueue(queue: PendingCareRecord[]): void {
    localStorage.setItem(CareRecordService.queueKey, JSON.stringify(queue));
    this.pendingCount.set(queue.length);
  }

  /**
   * The browser online event can occur before the API is reachable, and it
   * does not occur when only the local API is restarted.
   */
  private requestSync(): void {
    this.clearRetry();
    void this.syncPending();
  }

  private scheduleRetry(): void {
    this.clearRetry();
    if (!this.connectivity.isOnline() || !this.readQueue().length || this.isSynchronizing()) {
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
