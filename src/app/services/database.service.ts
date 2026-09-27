import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { PetDraft, StoredPet } from './pet.model';
import { CarePlanDraft, CarePlanEntry } from './care-plan.model';

export interface UserRecord {
  id: number;
  username: string;
  password: string;
  phone: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private readonly databaseName = 'petcare';
  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private database?: SQLiteDBConnection;
  private initialization?: Promise<void>;

  initialize(): Promise<void> {
    this.initialization ??= this.openDatabase().catch((error: unknown) => {
      this.initialization = undefined;
      throw error;
    });
    return this.initialization;
  }

  async registerUser(username: string, passwordHash: string, phone: string): Promise<void> {
    const database = await this.getDatabase();
    await database.run(
      'INSERT INTO users (username, password, phone, created_at) VALUES (?, ?, ?, ?)',
      [username, passwordHash, phone, new Date().toISOString()],
    );
    if (Capacitor.getPlatform() === 'web') await this.sqlite.saveToStore(this.databaseName);
  }

  async usernameExists(username: string): Promise<boolean> {
    return (await this.findUser('username', username)) !== undefined;
  }

  async phoneExists(phone: string): Promise<boolean> {
    return (await this.findUser('phone', phone)) !== undefined;
  }

  async validateLogin(username: string): Promise<UserRecord | undefined> {
    return this.findUser('username', username);
  }

  async getUserId(username: string): Promise<number | null> {
    const user = await this.findUser('username', username);
    return user?.id ?? null;
  }

  async getUserContact(username: string): Promise<{ username: string; phone: string } | null> {
    const user = await this.findUser('username', username);
    return user ? { username: user.username, phone: user.phone } : null;
  }

  async listPets(userId: number): Promise<StoredPet[]> {
    const database = await this.getDatabase();
    const result = await database.query(
      'SELECT id, name, species, breed, sex, age_years, weight_kg, created_at FROM pets WHERE user_id = ? ORDER BY id',
      [userId],
    );
    return (result.values ?? []).map((row) => ({
      id: String(row['id']),
      name: String(row['name']),
      species: row['species'] as PetDraft['species'],
      breed: String(row['breed'] ?? ''),
      sex: row['sex'] as PetDraft['sex'],
      ageYears: row['age_years'] === null ? null : Number(row['age_years']),
      weightKg: row['weight_kg'] === null ? null : Number(row['weight_kg']),
      createdAt: String(row['created_at']),
      pending: false,
    }));
  }

  async addPet(userId: number, draft: PetDraft): Promise<StoredPet> {
    const database = await this.getDatabase();
    const now = new Date().toISOString();
    const result = await database.run(
      'INSERT INTO pets (user_id, name, species, breed, sex, age_years, weight_kg, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, draft.name.trim(), draft.species, draft.breed.trim(), draft.sex, draft.ageYears, draft.weightKg, now, now],
    );
    await this.saveWebDatabase();
    const id = result.changes?.lastId;
    if (id === undefined) throw new Error('SQLite no devolvió el id de la mascota.');
    return { ...draft, name: draft.name.trim(), breed: draft.breed.trim(), id: String(id), createdAt: now, pending: false };
  }

  async updatePet(userId: number, id: string, draft: PetDraft): Promise<void> {
    const database = await this.getDatabase();
    const result = await database.run(
      'UPDATE pets SET name = ?, species = ?, breed = ?, sex = ?, age_years = ?, weight_kg = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [draft.name.trim(), draft.species, draft.breed.trim(), draft.sex, draft.ageYears, draft.weightKg, new Date().toISOString(), Number(id), userId],
    );
    if (result.changes?.changes !== 1) throw new Error('La mascota no existe para este usuario.');
    await this.saveWebDatabase();
  }

  async deletePet(userId: number, id: string): Promise<void> {
    const database = await this.getDatabase();
    const result = await database.run('DELETE FROM pets WHERE id = ? AND user_id = ?', [Number(id), userId]);
    if (result.changes?.changes !== 1) throw new Error('La mascota no existe para este usuario.');
    await this.saveWebDatabase();
  }

  async listCarePlans(userId: number): Promise<CarePlanEntry[]> {
    const database = await this.getDatabase();
    const result = await database.query(
      `SELECT plan.id, plan.pet_id, pets.name AS pet_name, plan.type, plan.title,
        plan.details, plan.due_at, plan.weight_kg, plan.temperature_c,
        plan.completed_at, plan.created_at
       FROM care_plans AS plan
       INNER JOIN pets ON pets.id = plan.pet_id AND pets.user_id = plan.user_id
       WHERE plan.user_id = ?
       ORDER BY CASE WHEN plan.completed_at IS NULL THEN 0 ELSE 1 END, plan.due_at ASC`,
      [userId],
    );
    return (result.values ?? []).map((row) => ({
      id: String(row['id']),
      petId: String(row['pet_id']),
      petName: String(row['pet_name']),
      type: row['type'] as CarePlanEntry['type'],
      title: String(row['title']),
      details: String(row['details'] ?? ''),
      dueAt: String(row['due_at']),
      weightKg: row['weight_kg'] === null ? null : Number(row['weight_kg']),
      temperatureC: row['temperature_c'] === null ? null : Number(row['temperature_c']),
      status: row['completed_at'] === null ? 'pending' : 'completed',
        completedAt: row['completed_at'] === null ? null : String(row['completed_at']),
      createdAt: String(row['created_at']),
    }));
  }

  async addCarePlan(userId: number, draft: CarePlanDraft & { id: string }): Promise<void> {
    const database = await this.getDatabase();
    const pet = await database.query(
      'SELECT id FROM pets WHERE id = ? AND user_id = ? LIMIT 1',
      [Number(draft.petId), userId],
    );
    if (!pet.values?.length) throw new Error('La mascota seleccionada no pertenece a esta cuenta.');
    const createdAt = new Date().toISOString();
    const completedAt = draft.type === 'Control de salud' ? createdAt : null;
    await database.run(
      `INSERT INTO care_plans
        (id, user_id, pet_id, type, title, details, due_at, weight_kg, temperature_c, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [draft.id, userId, Number(draft.petId), draft.type, draft.title.trim(), draft.details.trim(), draft.dueAt,
        draft.weightKg, draft.temperatureC, completedAt, createdAt],
    );
    await this.saveWebDatabase();
  }

  async setCarePlanCompleted(userId: number, id: string, completed: boolean): Promise<void> {
    const database = await this.getDatabase();
    const result = await database.run(
      'UPDATE care_plans SET completed_at = ? WHERE id = ? AND user_id = ?',
      [completed ? new Date().toISOString() : null, id, userId],
    );
    if (result.changes?.changes !== 1) throw new Error('El recordatorio ya no existe.');
    await this.saveWebDatabase();
  }

  async deleteCarePlan(userId: number, id: string): Promise<void> {
    const database = await this.getDatabase();
    const result = await database.run('DELETE FROM care_plans WHERE id = ? AND user_id = ?', [id, userId]);
    if (result.changes?.changes !== 1) throw new Error('El registro ya no existe.');
    await this.saveWebDatabase();
  }

  async listUsers(): Promise<UserRecord[]> {
    const database = await this.getDatabase();
    const result = await database.query('SELECT id, username, password, phone, created_at FROM users ORDER BY id');
    return (result.values ?? []) as UserRecord[];
  }

  private async findUser(field: 'username' | 'phone', value: string): Promise<UserRecord | undefined> {
    const database = await this.getDatabase();
    const result = await database.query(
      `SELECT id, username, password, phone, created_at FROM users WHERE ${field} = ? LIMIT 1`,
      [value],
    );
    return result.values?.[0] as UserRecord | undefined;
  }

  private async getDatabase(): Promise<SQLiteDBConnection> {
    await this.initialize();
    return this.database!;
  }

  private async saveWebDatabase(): Promise<void> {
    if (Capacitor.getPlatform() === 'web') await this.sqlite.saveToStore(this.databaseName);
  }

  private async openDatabase(): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      await customElements.whenDefined('jeep-sqlite');
      let jeepSqlite = document.querySelector('jeep-sqlite') as (HTMLElement & {
        componentOnReady?: () => Promise<unknown>;
        isStoreOpen: () => Promise<boolean>;
      }) | null;
      if (!jeepSqlite) {
        jeepSqlite = document.createElement('jeep-sqlite') as HTMLElement & {
          componentOnReady?: () => Promise<unknown>;
          isStoreOpen: () => Promise<boolean>;
        };
        document.body.appendChild(jeepSqlite);
      }
      await jeepSqlite.componentOnReady?.();
      await this.waitForWebStore(jeepSqlite);
      await this.sqlite.initWebStore();
    }

    const connected = await this.sqlite.isConnection(this.databaseName, false);
    this.database = connected.result
      ? await this.sqlite.retrieveConnection(this.databaseName, false)
      : await this.sqlite.createConnection(this.databaseName, false, 'no-encryption', 1, false);
    await this.database.open();
    await this.database.execute('PRAGMA foreign_keys = ON;');
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        species TEXT NOT NULL,
        breed TEXT,
        sex TEXT,
        age_years INTEGER,
        weight_kg REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pets_user_id ON pets(user_id);
      CREATE TABLE IF NOT EXISTS care_plans (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        pet_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        due_at TEXT NOT NULL,
        weight_kg REAL,
        temperature_c REAL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_care_plans_user_due ON care_plans(user_id, due_at);
    `);
  }

  private async waitForWebStore(element: HTMLElement & { isStoreOpen: () => Promise<boolean> }): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await element.isStoreOpen()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('jeep-sqlite no pudo abrir el almacenamiento IndexedDB del navegador.');
  }
}
