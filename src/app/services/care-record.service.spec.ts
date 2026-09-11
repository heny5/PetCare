import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CareRecordService } from './care-record.service';
import { ConnectivityService } from './connectivity.service';

const queueKey = 'petcare.pending-care-records';

function pendingRecord(id: string) {
  return {
    id,
    petName: 'Luna',
    description: 'Paseo',
    createdAt: '2026-01-01T00:00:00.000Z',
    queuedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('CareRecordService', () => {
  let online: boolean;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    online = false;
    localStorage.clear();
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('syncs the queue when the browser recovers its connection', async () => {
    localStorage.setItem(queueKey, JSON.stringify([pendingRecord('online-event')]));
    const service = new CareRecordService({ isOnline: () => online } as ConnectivityService);
    fetchMock.mockResolvedValue({ ok: true });

    online = true;
    window.dispatchEvent(new Event('online'));
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(service.pendingCount()).toBe(0);
  });

  it('retries queued records when the API becomes available later', async () => {
    localStorage.setItem(queueKey, JSON.stringify([pendingRecord('retry')]));
    const service = new CareRecordService({ isOnline: () => online } as ConnectivityService);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true });

    online = true;
    await service.syncPending();
    expect(service.pendingCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.pendingCount()).toBe(0);
  });
});