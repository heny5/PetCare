import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';
import { PetDraft, StoredPet, isPetDraft } from './pet.model';

@Injectable({ providedIn: 'root' })
export class PetService {
  private readonly auth = inject(AuthService);
  private readonly database = inject(DatabaseService);
  readonly storageError = signal(false);
  private readonly records = signal<StoredPet[]>([]);
  private readonly loadedUser = signal<string | null>(null);
  readonly pets = computed(() => this.loadedUser() === this.auth.currentUser()?.trim()
    ? this.records().filter((pet) => !pet.deleted)
    : []);
  readonly pendingCount = computed(() => this.loadedUser() === this.auth.currentUser()?.trim()
    ? this.records().filter((pet) => pet.pending).length
    : 0);
  readonly isSynchronizing = signal(false);
  readonly syncError = signal(false);
  private loadTask: Promise<void> | undefined;

  activate(): void {
    const username = this.auth.currentUser()?.trim();
    if (!username || username === this.loadedUser() || this.loadTask) return;
    this.records.set([]);
    this.loadTask = this.loadUserPets(username).finally(() => {
      this.loadTask = undefined;
      const activeUsername = this.auth.currentUser()?.trim();
      if (activeUsername && activeUsername !== username) this.activate();
    });
  }

  async sync(): Promise<void> {
    await this.reloadCurrentUserPets();
  }

  async add(draft: PetDraft): Promise<StoredPet> {
    if (!isPetDraft(draft)) throw new Error('Revisa el nombre, la especie, el sexo, la edad y el peso.');
    const { userId, username } = await this.ensureCurrentUserLoaded();
    const pet = await this.database.addPet(userId, draft);
    await this.reloadPets(userId, username);
    return pet;
  }

  async update(id: string, draft: PetDraft): Promise<StoredPet> {
    if (!isPetDraft(draft)) throw new Error('Revisa los datos de la mascota.');
    const { userId, username } = await this.ensureCurrentUserLoaded();
    const current = this.requirePet(id);
    await this.database.updatePet(userId, id, draft);
    const pet: StoredPet = {
      ...current, ...draft, id: current.id, createdAt: current.createdAt,
      name: draft.name.trim(), breed: draft.breed.trim(),
      pending: false,
    };
    await this.reloadPets(userId, username);
    return pet;
  }

  async remove(id: string): Promise<void> {
    const { userId, username } = await this.ensureCurrentUserLoaded();
    this.requirePet(id);
    await this.database.deletePet(userId, id);
    await this.reloadPets(userId, username);
  }

  private requirePet(id: string): StoredPet {
    if (this.storageError()) throw new Error('No se pudieron leer las mascotas guardadas.');
    const pet = this.pets().find((item) => item.id === id);
    if (!pet) throw new Error('La mascota ya no existe.');
    return pet;
  }

  private async loadUserPets(username: string): Promise<void> {
    this.isSynchronizing.set(true);
    this.storageError.set(false);
    this.syncError.set(false);
    try {
      await this.database.initialize();
      const userId = await this.database.getUserId(username);
      if (userId === null) throw new Error('No se encontró la cuenta activa.');
      const pets = await this.database.listPets(userId);
      if (this.auth.currentUser()?.trim() !== username) return;
      this.records.set(pets);
      this.loadedUser.set(username);
    } catch {
      this.storageError.set(true);
      this.records.set([]);
    } finally {
      this.isSynchronizing.set(false);
    }
  }

  private async reloadPets(userId: number, username: string): Promise<void> {
    const pets = await this.database.listPets(userId);
    if (this.auth.currentUser()?.trim() !== username) return;
    this.records.set(pets);
    this.loadedUser.set(username);
  }

  private async reloadCurrentUserPets(): Promise<void> {
    const username = this.auth.currentUser()?.trim();
    if (!username) {
      this.records.set([]);
      this.loadedUser.set(null);
      return;
    }
    this.loadedUser.set(null);
    this.loadTask = this.loadUserPets(username);
    await this.loadTask;
    this.loadTask = undefined;
  }

  private async getCurrentUser(): Promise<{ userId: number; username: string }> {
    const username = this.auth.currentUser()?.trim();
    if (!username) throw new Error('Debes iniciar sesión para modificar tus mascotas.');
    await this.database.initialize();
    const userId = await this.database.getUserId(username);
    if (userId === null) throw new Error('No se encontró la cuenta activa.');
    if (this.auth.currentUser()?.trim() !== username) throw new Error('La sesión cambió durante la operación.');
    return { userId, username };
  }

  private async ensureCurrentUserLoaded(): Promise<{ userId: number; username: string }> {
    const user = await this.getCurrentUser();
    const { username } = user;
    while (this.loadedUser() !== username) {
      if (this.storageError()) throw new Error('No se pudieron leer las mascotas guardadas.');
      if (!this.loadTask) {
        const task = this.loadUserPets(username);
        this.loadTask = task;
        try {
          await task;
        } finally {
          if (this.loadTask === task) this.loadTask = undefined;
        }
      } else {
        await this.loadTask;
      }
      if (this.auth.currentUser()?.trim() !== username) throw new Error('La sesión cambió durante la operación.');
    }
    return user;
  }
}
