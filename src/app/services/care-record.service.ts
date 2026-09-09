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

  readonly pendingCount = signal(this.readQueue().length);
  readonly isSynchronizing = signal(false);

  constructor(private readonly connectivity: ConnectivityService) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.syncPending());
    }

    if (this.connectivity.isOnline()) {
      void this.syncPending();
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
      return 'sent';
    } catch {
      this.enqueue(entry);
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
      for (let index = 0; index < queue.length; index += 1) {
        try {
          await this.sendToServer(queue[index]);
        } catch {
          this.writeQueue(queue.slice(index));
          return;
        }
      }
      this.writeQueue([]);
    } finally {
      this.isSynchronizing.set(false);
    }
  }

  private async sendToServer(record: CareRecord): Promise<void> {
    const response = await fetch(environment.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });

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
}
