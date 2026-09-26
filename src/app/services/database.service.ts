import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

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
    this.initialization ??= this.openDatabase();
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

  private async openDatabase(): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      const { defineCustomElements } = await import('jeep-sqlite/loader');
      defineCustomElements(window);
      await customElements.whenDefined('jeep-sqlite');
      document.body.appendChild(document.createElement('jeep-sqlite'));
      await this.sqlite.initWebStore();
    }

    const connected = await this.sqlite.isConnection(this.databaseName, false);
    this.database = connected.result
      ? await this.sqlite.retrieveConnection(this.databaseName, false)
      : await this.sqlite.createConnection(this.databaseName, false, 'no-encryption', 1, false);
    await this.database.open();
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
    `);
  }
}