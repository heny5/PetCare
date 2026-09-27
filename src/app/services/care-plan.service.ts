import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';
import { CarePlanDraft, CarePlanEntry, isCarePlanType } from './care-plan.model';

@Injectable({ providedIn: 'root' })
export class CarePlanService {
  private readonly auth = inject(AuthService);
  private readonly database = inject(DatabaseService);
  private readonly records = signal<CarePlanEntry[]>([]);
  private readonly loadedUser = signal<string | null>(null);
  private loadTask?: Promise<void>;

  readonly entries = this.records.asReadonly();
  readonly isLoading = signal(false);
  readonly loadError = signal(false);
  readonly saveError = signal('');
  readonly pendingEntries = computed(() => this.entries()
    .filter((entry) => entry.status === 'pending')
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)));
  readonly completedEntries = computed(() => this.entries()
    .filter((entry) => entry.status === 'completed')
    .sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt)));
  readonly reminderCount = computed(() => this.pendingEntries().length);

  activate(): Promise<void> {
    const username = this.auth.currentUser()?.trim();
    if (!username) {
      this.records.set([]);
      this.loadedUser.set(null);
      return Promise.resolve();
    }
    if (this.loadedUser() === username) return Promise.resolve();
    if (this.loadTask) return this.loadTask.then(() => this.activate());

    this.isLoading.set(true);
    this.loadError.set(false);
    this.loadTask = this.loadForUser(username).finally(() => {
      this.loadTask = undefined;
      this.isLoading.set(false);
      if (this.auth.currentUser()?.trim() !== username) void this.activate();
    });
    return this.loadTask;
  }

  async reload(): Promise<void> {
    this.loadedUser.set(null);
    await this.activate();
  }

  async add(draft: CarePlanDraft): Promise<void> {
    this.saveError.set('');
    if (!draft.petId || !isCarePlanType(draft.type)) throw new Error('Selecciona una mascota y un tipo de cuidado.');
    if (!draft.title.trim() || draft.title.trim().length > 100) throw new Error('Escribe un nombre de hasta 100 caracteres.');
    if (draft.details.length > 500) throw new Error('Los detalles deben tener 500 caracteres o menos.');
    if (!Number.isFinite(Date.parse(draft.dueAt))) throw new Error('Indica una fecha válida.');
    if (draft.weightKg !== null && (!Number.isFinite(draft.weightKg) || draft.weightKg <= 0 || draft.weightKg > 300)) {
      throw new Error('Revisa el peso registrado.');
    }
    if (draft.temperatureC !== null && (!Number.isFinite(draft.temperatureC) || draft.temperatureC < 20 || draft.temperatureC > 50)) {
      throw new Error('Revisa la temperatura registrada.');
    }
    if (draft.type === 'Control de salud' && draft.weightKg === null && draft.temperatureC === null) {
      throw new Error('Registra el peso, la temperatura o ambos para guardar el control.');
    }

    await this.activate();
    const username = this.auth.currentUser()?.trim();
    if (!username) throw new Error('Inicia sesión para guardar los cuidados.');
    const userId = await this.database.getUserId(username);
    if (userId === null || this.auth.currentUser()?.trim() !== username) throw new Error('La sesión cambió. Vuelve a intentarlo.');
    await this.database.addCarePlan(userId, { ...draft, id: crypto.randomUUID() });
    await this.reload();
  }

  async setCompleted(id: string, completed: boolean): Promise<void> {
    const userId = await this.getCurrentUserId();
    await this.database.setCarePlanCompleted(userId, id, completed);
    await this.reload();
  }

  async remove(id: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    await this.database.deleteCarePlan(userId, id);
    await this.reload();
  }

  latestMeasurement(petId: string): CarePlanEntry | undefined {
    return this.entries()
      .filter((entry) => entry.petId === petId && entry.type === 'Control de salud')
      .sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt))[0];
  }

  private async loadForUser(username: string): Promise<void> {
    try {
      await this.database.initialize();
      const userId = await this.database.getUserId(username);
      if (userId === null) throw new Error('No se encontró la cuenta activa.');
      const records = await this.database.listCarePlans(userId);
      if (this.auth.currentUser()?.trim() !== username) return;
      this.records.set(records);
      this.loadedUser.set(username);
      this.loadError.set(false);
    } catch (error) {
      console.error('No se pudieron cargar los cuidados guardados.', error);
      this.loadError.set(true);
      this.records.set([]);
    }
  }

  private async getCurrentUserId(): Promise<number> {
    await this.activate();
    const username = this.auth.currentUser()?.trim();
    if (!username) throw new Error('Inicia sesión para modificar los cuidados.');
    const userId = await this.database.getUserId(username);
    if (userId === null || this.auth.currentUser()?.trim() !== username) throw new Error('La sesión cambió. Vuelve a intentarlo.');
    return userId;
  }
}
