import { Injectable, inject, signal } from '@angular/core';
import { DatabaseService } from './database.service';

export type RegistrationResult = 'success' | 'username-exists' | 'phone-exists';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private static readonly sessionKey = 'petcare.auth.username';
  private readonly database = inject(DatabaseService);
  readonly currentUser = signal<string | null>(localStorage.getItem(AuthService.sessionKey));

  async register(username: string, password: string, phone: string): Promise<RegistrationResult> {
    const normalizedUsername = username.trim();
    const normalizedPhone = phone.trim();
    await this.database.initialize();
    if (await this.database.phoneExists(normalizedPhone)) return 'phone-exists';
    if (await this.database.usernameExists(normalizedUsername)) return 'username-exists';
    await this.database.registerUser(normalizedUsername, await this.hashPassword(password), normalizedPhone);
    return 'success';
  }

  async login(username: string, password: string): Promise<boolean> {
    const normalizedUsername = username.trim();
    const user = await this.database.validateLogin(normalizedUsername);
    if (!user || !(await this.verifyPassword(password, user.password))) return false;
    localStorage.setItem(AuthService.sessionKey, user.username);
    this.currentUser.set(user.username);
    return true;
  }

  logout(): void {
    localStorage.removeItem(AuthService.sessionKey);
    this.currentUser.set(null);
  }

  isAuthenticated(): boolean {
    return this.currentUser() !== null;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' }, key, 256);
    return `pbkdf2$210000$${this.toBase64(salt)}$${this.toBase64(new Uint8Array(bits))}`;
  }

  private async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, iterationText, saltText, hashText] = stored.split('$');
    if (scheme !== 'pbkdf2' || !iterationText || !saltText || !hashText) return false;
    const salt = this.fromBase64(saltText);
    const expected = this.fromBase64(hashText);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const actual = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: Number(iterationText), hash: 'SHA-256' }, key, expected.length * 8,
    ));
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  }

  private toBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
  }

  private fromBase64(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
}