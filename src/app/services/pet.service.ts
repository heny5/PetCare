import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';
import { PetDraft, StoredPet, isPet, isPetDraft } from './pet.model';

/** Administra las mascotas del usuario activo mediante el almacenamiento SQLite. */
@Injectable({ providedIn: 'root' })
export class PetService {
  private readonly auth = inject(AuthService);
  private readonly database = inject(DatabaseService);
  // Estados de error para informar problemas al cargar los perfiles guardados.
  readonly storageError = signal(false);
  readonly storageErrorDetail = signal('');
  // Mantiene los registros cargados y la cuenta a la que pertenecen.
  private readonly records = signal<StoredPet[]>([]);
  private readonly loadedUser = signal<string | null>(null);
  // Expone las mascotas no eliminadas solo cuando los datos pertenecen a la sesión activa.
  readonly pets = computed(() => this.loadedUser() === this.auth.currentUser()?.trim()
    ? this.records().filter((pet) => !pet.deleted)
    : []);
  // Cuenta registros pendientes de la cuenta cargada, incluidas posibles eliminaciones.
  readonly pendingCount = computed(() => this.loadedUser() === this.auth.currentUser()?.trim()
    ? this.records().filter((pet) => pet.pending).length
    : 0);
  readonly isSynchronizing = signal(false);
  readonly syncError = signal(false);
  // Comparte la carga en curso para evitar iniciar varias lecturas simultáneas.
  private loadTask: Promise<void> | undefined;

  /** Inicia la carga de la cuenta activa y vuelve a cargar si la sesión cambió durante la espera. */
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

  // Recarga las mascotas de la cuenta actual desde la base de datos local.
  async sync(): Promise<void> {
    await this.reloadCurrentUserPets();
  }

  /** Valida y guarda una nueva ficha asociada al usuario activo. */
  async add(draft: PetDraft): Promise<StoredPet> {
    if (!isPetDraft(draft)) throw new Error('Revisa el nombre, la especie, el sexo, la edad y el peso.');
    const { userId, username } = await this.ensureCurrentUserLoaded();
    const pet = await this.database.addPet(userId, draft);
    await this.reloadPets(userId, username);
    return pet;
  }

  /** Actualiza una ficha existente y conserva su identificador y fecha de creación. */
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

  // Comprueba que la ficha está disponible, la elimina y actualiza la lista.
  async remove(id: string): Promise<void> {
    const { userId, username } = await this.ensureCurrentUserLoaded();
    this.requirePet(id);
    await this.database.deletePet(userId, id);
    await this.reloadPets(userId, username);
  }

  // Impide modificar fichas ausentes o trabajar con una carga que falló.
  private requirePet(id: string): StoredPet {
    if (this.storageError()) throw new Error('No se pudieron leer las mascotas guardadas.');
    const pet = this.pets().find((item) => item.id === id);
    if (!pet) throw new Error('La mascota ya no existe.');
    return pet;
  }

  /** Carga desde SQLite y recupera perfiles antiguos si la cuenta aún no tiene mascotas. */
  private async loadUserPets(username: string): Promise<void> {
    this.isSynchronizing.set(true);
    this.storageError.set(false);
    this.storageErrorDetail.set('');
    this.syncError.set(false);
    try {
      await this.database.initialize();
      const userId = await this.database.getUserId(username);
      if (userId === null) throw new Error('No se encontró la cuenta activa.');
      let pets = await this.database.listPets(userId);
      if (pets.length === 0) {
        pets = await this.migrateLegacyPets(userId);
      }
      // Descarta la carga si el usuario cambió mientras se consultaba la base de datos.
      if (this.auth.currentUser()?.trim() !== username) return;
      this.records.set(pets);
      this.loadedUser.set(username);
    } catch (error) {
      console.error('No se pudieron cargar las mascotas desde SQLite.', error);
      this.storageErrorDetail.set(error instanceof Error ? error.message : String(error));
      this.storageError.set(true);
      this.records.set([]);
    } finally {
      this.isSynchronizing.set(false);
    }
  }

  /** Importa una vez las fichas válidas de la antigua clave petcare.pets. */
  private async migrateLegacyPets(userId: number): Promise<StoredPet[]> {
    // La marca de migración evita volver a importar los mismos perfiles.
    const migrationKey = 'petcare.legacy-pets-migrated';
    if (localStorage.getItem(migrationKey)) return [];

    const legacyData = localStorage.getItem('petcare.pets');
    if (legacyData === null) return [];

    const parsed: unknown = JSON.parse(legacyData);
    if (!Array.isArray(parsed)) throw new Error('Los perfiles anteriores tienen un formato inválido.');
    const legacyPets = parsed.filter((pet): pet is StoredPet =>
      isPet(pet) && !(pet as StoredPet).deleted
    );
    const migrated: StoredPet[] = [];
    for (const pet of legacyPets) {
      migrated.push(await this.database.addPet(userId, pet));
    }
    // Registra la migración después de insertar las mascotas recuperadas.
    localStorage.setItem(migrationKey, 'true');
    return migrated;
  }

  // Refresca la lista después de una escritura si la sesión sigue siendo la misma.
  private async reloadPets(userId: number, username: string): Promise<void> {
    const pets = await this.database.listPets(userId);
    if (this.auth.currentUser()?.trim() !== username) return;
    this.records.set(pets);
    this.loadedUser.set(username);
  }

  // Vacía la vista sin sesión o fuerza una nueva carga para el usuario conectado.
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

  /** Resuelve el ID de la cuenta y comprueba que la sesión no cambió durante la consulta. */
  private async getCurrentUser(): Promise<{ userId: number; username: string }> {
    const username = this.auth.currentUser()?.trim();
    if (!username) throw new Error('Debes iniciar sesión para modificar tus mascotas.');
    await this.database.initialize();
    const userId = await this.database.getUserId(username);
    if (userId === null) throw new Error('No se encontró la cuenta activa.');
    if (this.auth.currentUser()?.trim() !== username) throw new Error('La sesión cambió durante la operación.');
    return { userId, username };
  }

  /** Espera una carga válida de la cuenta actual antes de permitir cambios en sus mascotas. */
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
