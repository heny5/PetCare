import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { CareRecordService } from './care-record.service';
import { ConnectivityService } from './connectivity.service';

const queueKey = 'petcare.pending-care-records';
const legacyKey = 'petcare-pendientes';

function pendingRecord(id: string) {
  return {
    id, petName: 'Luna', description: 'Paseo',
    createdAt: '2026-01-01T00:00:00.000Z',
    queuedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('CareRecordService', () => {
  let connectivity: ConnectivityService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    connectivity = TestBed.inject(ConnectivityService);
    connectivity.setDemoOnline(false);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function createService() {
    const service = TestBed.inject(CareRecordService);
    TestBed.tick();
    return service;
  }

  it('syncs pending records on the real browser online event', async () => {
    connectivity.useRealNetwork();
    connectivity.updateNetworkStatus(false);
    localStorage.setItem(queueKey, JSON.stringify([pendingRecord('online-event')]));
    const service = createService();
    fetchMock.mockResolvedValue({ ok: true });

    window.dispatchEvent(new Event('online'));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(environment.apiUrl);
    expect(service.pendingCount()).toBe(0);
  });

  it('keeps demo offline records queued even when the real network comes back', async () => {
    const service = createService();
    await service.save({ petName: 'Luna', description: 'Paseo' });
    window.dispatchEvent(new Event('online'));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.pendingCount()).toBe(1);

    fetchMock.mockResolvedValue({ ok: true });
    connectivity.useRealNetwork();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.pendingCount()).toBe(0);
  });

  it('retries when the API becomes available without another network event', async () => {
    localStorage.setItem(queueKey, JSON.stringify([pendingRecord('retry')]));
    const service = createService();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true });

    connectivity.setDemoOnline(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.pendingCount()).toBe(1);
    expect(service.syncError()).toBe(true);
    expect(service.isSynchronizing()).toBe(false);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.pendingCount()).toBe(0);
    expect(service.syncError()).toBe(false);
  });

  it('persists online saves before sending and serializes overlapping saves', async () => {
    const service = createService();
    connectivity.setDemoOnline(true);
    let resolveFirst!: (value: { ok: boolean }) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue({ ok: true });

    const first = service.save({ petName: 'Milo', description: 'Comida' });
    const second = service.save({ petName: 'Luna', description: 'Paseo' });
    expect(JSON.parse(localStorage.getItem(queueKey)!)).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(service.isSynchronizing()).toBe(true);

    resolveFirst({ ok: true });
    expect(await Promise.all([first, second])).toEqual(['sent', 'sent']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(sent.map((record) => record.petName)).toEqual(['Milo', 'Luna']);
    expect(new Set(sent.map((record) => record.id)).size).toBe(2);
    expect(service.pendingCount()).toBe(0);
    expect(service.isSynchronizing()).toBe(false);
  });

  it('unlocks synchronization after the 10 second request timeout', async () => {
    const service = createService();
    connectivity.setDemoOnline(true);
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    const save = service.save({ petName: 'Luna', description: 'Paseo' });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await save).toBe('queued');
    expect(service.isSynchronizing()).toBe(false);
    expect(service.syncError()).toBe(true);
    expect(service.pendingCount()).toBe(1);
    expect(JSON.parse(localStorage.getItem(queueKey)!)).toHaveLength(1);
  });

  it('keeps rejected records and the remaining queue for retry', async () => {
    localStorage.setItem(queueKey, JSON.stringify([pendingRecord('one'), pendingRecord('two')]));
    const service = createService();
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    connectivity.setDemoOnline(true);
    await service.syncPending();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(service.pendingCount()).toBe(2);
    expect(service.isSynchronizing()).toBe(false);
    expect(service.syncError()).toBe(true);
  });

  it('merges the old screen queue with the service queue without duplicates', () => {
    localStorage.setItem(queueKey, JSON.stringify([pendingRecord('existing')]));
    localStorage.setItem(legacyKey, JSON.stringify([
      { id: 'existing', tipo: 'Cuidado de Luna', detalle: 'Paseo', fecha: '2026-01-01T00:00:00.000Z' },
      { id: 'PET-old', tipo: 'Cuidado de Milo', detalle: 'Comida', fecha: '2026-09-24T10:00:00.000Z' },
    ]));

    const service = createService();
    expect(service.pendingCount()).toBe(2);
    expect(service.pendingRecords()[1]).toMatchObject({
      id: 'PET-old', petName: 'Milo', description: 'Comida', createdAt: '2026-09-24T10:00:00.000Z',
    });
    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(JSON.parse(localStorage.getItem(queueKey)!)).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves legacy records when the destination storage cannot be written', () => {
    const legacy = JSON.stringify([
      { id: 'PET-old', tipo: 'Cuidado de Luna', detalle: 'Paseo', fecha: '2026-09-24T10:00:00.000Z' },
    ]);
    localStorage.setItem(legacyKey, legacy);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });

    const service = createService();
    expect(localStorage.getItem(legacyKey)).toBe(legacy);
    expect(service.migrationError()).toBe(true);
  });

  it('retains malformed legacy entries instead of silently discarding them', () => {
    localStorage.setItem(legacyKey, JSON.stringify([{ id: 'incomplete' }]));
    const service = createService();
    expect(JSON.parse(localStorage.getItem(legacyKey)!)).toEqual([{ id: 'incomplete' }]);
    expect(service.migrationError()).toBe(true);
  });
});
