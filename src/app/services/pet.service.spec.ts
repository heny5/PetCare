import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PetService } from './pet.service';
import { ConnectivityService } from './connectivity.service';
import { PetDraft } from './pet.model';
import { environment } from '../../environments/environment';

const key = 'petcare.pets';
const draft: PetDraft = {
  name: ' Coco ', species: 'Gato', breed: ' Mestizo ', sex: 'Macho', ageYears: 2, weightKg: 4.5,
};
const reply = (body: unknown) => ({ ok: true, json: async () => body });

describe('PetService', () => {
  let network: ConnectivityService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    network = TestBed.inject(ConnectivityService);
    network.setDemoOnline(false);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('persists offline before sending and restores the same profile after reload', () => {
    const service = TestBed.inject(PetService);
    const pet = service.add(draft);
    TestBed.tick();
    expect(pet).toMatchObject({ name: 'Coco', breed: 'Mestizo', pending: true });
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([pet]);
    expect(fetchMock).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    const restored = TestBed.inject(PetService);
    expect(restored.pets().find((item) => item.id === pet.id)).toEqual(pet);
    expect(restored.pendingCount()).toBe(1);
  });

  it('sends a pending pet on network recovery and keeps its profile after acknowledgment', async () => {
    const service = TestBed.inject(PetService);
    const pet = service.add(draft);
    TestBed.tick();
    fetchMock.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply({ record: pet }));
    network.useRealNetwork();
    window.dispatchEvent(new Event('online'));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(environment.petsApiUrl);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ id: pet.id, name: 'Coco' });
    expect(service.pendingCount()).toBe(0);
    expect(JSON.parse(localStorage.getItem(key)!)[0]).toMatchObject({ id: pet.id, pending: false });
    expect(service.pets()).toHaveLength(3);
  });

  it('retries with the same id if the server saves a pet but its response is lost', async () => {
    const service = TestBed.inject(PetService);
    const pet = service.add(draft);
    TestBed.tick();
    fetchMock.mockResolvedValueOnce(reply([])).mockRejectedValueOnce(new Error('Response lost'));
    network.setDemoOnline(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.pendingCount()).toBe(1);
    expect(service.syncError()).toBe(true);
    expect(service.isSynchronizing()).toBe(false);

    fetchMock.mockResolvedValueOnce(reply([pet])).mockResolvedValueOnce(reply({ record: pet, duplicate: true }));
    await vi.advanceTimersByTimeAsync(15_000);
    const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST');
    expect(posts.map((call) => JSON.parse(call[1].body).id)).toEqual([pet.id, pet.id]);
    expect(service.pendingCount()).toBe(0);
    expect(service.pets().filter((item) => item.id === pet.id)).toHaveLength(1);
  });

  it('releases a stalled request after ten seconds without losing the pending pet', async () => {
    const service = TestBed.inject(PetService);
    service.add(draft);
    TestBed.tick();
    fetchMock.mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }));
    network.setDemoOnline(true);
    TestBed.tick();
    expect(service.isSynchronizing()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.isSynchronizing()).toBe(false);
    expect(service.syncError()).toBe(true);
    expect(service.pendingCount()).toBe(1);
  });

  it('merges remote pets without losing a pet added while the download is in progress', async () => {
    const service = TestBed.inject(PetService);
    let resolveDownload!: (value: ReturnType<typeof reply>) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveDownload = resolve; }));
    fetchMock.mockResolvedValue(reply({}));
    network.setDemoOnline(true);
    service.activate();
    TestBed.tick();
    const added = service.add(draft);
    const remote = { ...draft, id: 'remote-pet', name: 'Nala', createdAt: '2026-01-01T00:00:00.000Z' };
    const synchronizing = service.sync();
    resolveDownload(reply([remote]));
    await synchronizing;
    expect(service.pets().map((pet) => pet.id)).toEqual(['demo-luna', 'demo-milo', added.id, remote.id]);
    expect(service.pendingCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid input and preserves the existing list when storage is full', () => {
    const service = TestBed.inject(PetService);
    expect(() => service.add({ ...draft, name: ' ' })).toThrow();
    expect(() => service.add({ ...draft, weightKg: -1 })).toThrow();
    expect(() => service.add({ ...draft, ageYears: 2.5 })).toThrow();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    expect(() => service.add(draft)).toThrow();
    expect(service.pets()).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves unreadable local data instead of replacing it with a remote list', async () => {
    localStorage.setItem(key, 'unreadable');
    const service = TestBed.inject(PetService);
    network.setDemoOnline(true);
    service.activate();
    TestBed.tick();
    await service.sync();
    expect(service.storageError()).toBe(true);
    expect(() => service.add(draft)).toThrow();
    expect(localStorage.getItem(key)).toBe('unreadable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resumes a persisted pending pet on startup without having to open the list again', async () => {
    const first = TestBed.inject(PetService);
    const pet = first.add(draft);
    TestBed.resetTestingModule();
    localStorage.removeItem('petcare-demo-online');
    fetchMock.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply({ record: pet }));
    const restored = TestBed.inject(PetService);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(restored.pendingCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).id).toBe(pet.id);
  });
});
