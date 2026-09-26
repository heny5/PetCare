import { Injectable, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { environment } from '../../environments/environment';
import { ConnectivityService } from './connectivity.service';
import { DEMO_PETS, PetDraft, StoredPet, isPet, isPetDraft } from './pet.model';

@Injectable({ providedIn: 'root' })
export class PetService implements OnDestroy {
  private static readonly storageKey = 'petcare.pets';
  private readonly connectivity = inject(ConnectivityService);
  readonly storageError = signal(false);
  private readonly records = signal<StoredPet[]>(this.readRecords());
  private readonly active = signal(this.records().some((pet) => pet.pending));
  private task: Promise<void> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | undefined;
  private destroyed = false;

  readonly pets = computed(() => {
    const pets = new Map([...DEMO_PETS, ...this.records()].map((pet) => [pet.id, pet]));
    return [...pets.values()].filter((pet) => !pet.deleted);
  });
  readonly pendingCount = computed(() => this.records().filter((pet) => pet.pending).length);
  readonly isSynchronizing = signal(false);
  readonly syncError = signal(false);

  constructor() {
    effect(() => {
      const active = this.active();
      const online = this.connectivity.isOnline();
      untracked(() => {
        this.clearRetry();
        if (active && online) void this.sync();
        else this.request?.abort();
      });
    });
  }

  activate(): void {
    this.active.set(true);
    void this.sync();
  }

  add(draft: PetDraft): StoredPet {
    if (!isPetDraft(draft)) throw new Error('Revisa el nombre, la especie, el sexo, la edad y el peso.');
    if (this.storageError()) throw new Error('No se pudieron leer las mascotas guardadas.');
    const pet: StoredPet = {
      ...draft, name: draft.name.trim(), breed: draft.breed.trim(),
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), pending: true,
    };
    // Persist before changing the list or starting a network request.
    this.writeRecords([...this.records(), pet]);
    this.activate();
    return pet;
  }

  update(id: string, draft: PetDraft): StoredPet {
    if (!isPetDraft(draft)) throw new Error('Revisa los datos de la mascota.');
    const current = this.requirePet(id);
    const pet: StoredPet = {
      ...current, ...draft, id: current.id, createdAt: current.createdAt,
      name: draft.name.trim(), breed: draft.breed.trim(),
      pending: !id.startsWith('demo-'), operation: 'PUT',
    };
    this.writeRecords([...this.records().filter((item) => item.id !== id), pet]);
    this.activate();
    return pet;
  }

  remove(id: string): void {
    const current = this.requirePet(id);
    this.writeRecords([...this.records().filter((item) => item.id !== id), {
      ...current, deleted: true, pending: !id.startsWith('demo-'),
    }]);
    this.activate();
  }

  private requirePet(id: string): StoredPet {
    if (this.storageError()) throw new Error('No se pudieron leer las mascotas guardadas.');
    const pet = this.pets().find((item) => item.id === id);
    if (!pet) throw new Error('La mascota ya no existe.');
    return pet;
  }

  sync(): Promise<void> {
    if (this.task) return this.task;
    if (this.destroyed || !this.active() || !this.connectivity.isOnline() || this.storageError()) {
      return Promise.resolve();
    }
    this.clearRetry();
    this.isSynchronizing.set(true);
    this.syncError.set(false);
    this.task = this.synchronize().catch(() => {
      if (!this.destroyed) this.syncError.set(this.connectivity.isOnline());
    }).finally(() => {
      this.task = undefined;
      this.isSynchronizing.set(false);
      if (!this.destroyed && this.connectivity.isOnline() && (this.pendingCount() || this.syncError())) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          void this.sync();
        }, 15_000);
      }
    });
    return this.task;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearRetry();
    this.request?.abort();
  }

  private async synchronize(): Promise<void> {
    const remote: unknown = await this.fetchJson();
    if (!Array.isArray(remote) || !remote.every(isPet)) throw new Error('Invalid pet list');
    const merged = new Map(this.records().map((pet) => [pet.id, pet]));
    for (const pet of remote) {
      if (!DEMO_PETS.some((demo) => demo.id === pet.id) && !merged.get(pet.id)?.pending && !merged.get(pet.id)?.deleted) {
        merged.set(pet.id, { ...pet, pending: false });
      }
    }
    this.writeRecords([...merged.values()]);
    while (!this.destroyed && this.connectivity.isOnline()) {
      const pet = this.records().find((item) => item.pending);
      if (!pet) break;
      await this.fetchJson({
        method: pet.deleted ? 'DELETE' : pet.operation ?? 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pet.id, name: pet.name, species: pet.species, breed: pet.breed,
          sex: pet.sex, ageYears: pet.ageYears, weightKg: pet.weightKg, createdAt: pet.createdAt,
        }),
      }, pet.deleted || pet.operation ? `/${encodeURIComponent(pet.id)}` : '');
      // A change made during the request must remain pending for the next pass.
      this.writeRecords(this.records().map((item) => item === pet ? { ...item, pending: false } : item));
    }
  }

  private async fetchJson(options?: RequestInit, suffix = ''): Promise<unknown> {
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(environment.petsApiUrl + suffix, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error('Pet request failed');
      return await response.json();
    } finally {
      clearTimeout(timeout);
      this.request = undefined;
    }
  }

  private readRecords(): StoredPet[] {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(PetService.storageKey) ?? '[]');
      if (!Array.isArray(stored) || !stored.every((pet) => isPet(pet) && typeof (pet as StoredPet).pending === 'boolean')) {
        throw new Error('Invalid stored pets');
      }
      return stored;
    } catch {
      this.storageError.set(true);
      return [];
    }
  }

  private writeRecords(records: StoredPet[]): void {
    localStorage.setItem(PetService.storageKey, JSON.stringify(records));
    this.records.set(records);
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }
}
