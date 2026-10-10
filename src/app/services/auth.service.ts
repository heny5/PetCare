import { Injectable, inject, signal } from '@angular/core';
import { DatabaseService } from './database.service';

/** Resultado del registro: creación correcta o coincidencia de usuario o teléfono. */
export type RegistrationResult = 'success' | 'username-exists' | 'phone-exists';

/** Gestiona cuentas locales, verificación de contraseñas y estado de la sesión. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  // Clave usada para recuperar el nombre de usuario de la sesión al abrir la aplicación.
  private static readonly sessionKey = 'petcare.auth.username';
  private readonly database = inject(DatabaseService);
  // La señal mantiene el usuario activo disponible para las pantallas y los servicios.
  readonly currentUser = signal<string | null>(localStorage.getItem(AuthService.sessionKey));

  /** Normaliza los datos, evita cuentas duplicadas y guarda la contraseña derivada. */
  async register(username: string, password: string, phone: string): Promise<RegistrationResult> {
    const normalizedUsername = username.trim();
    const normalizedPhone = phone.trim();
    await this.database.initialize();
    if (await this.database.phoneExists(normalizedPhone)) return 'phone-exists';
    if (await this.database.usernameExists(normalizedUsername)) return 'username-exists';
    await this.database.registerUser(normalizedUsername, await this.hashPassword(password), normalizedPhone);
    return 'success';
  }

  /** Comprueba las credenciales y conserva el nombre de usuario de la sesión iniciada. */
  async login(username: string, password: string): Promise<boolean> {
    const normalizedUsername = username.trim();
    const user = await this.database.validateLogin(normalizedUsername);
    if (!user || !(await this.verifyPassword(password, user.password))) return false;
    localStorage.setItem(AuthService.sessionKey, user.username);
    this.currentUser.set(user.username);
    return true;
  }

  // Borra la sesión persistida y actualiza inmediatamente su estado en memoria.
  logout(): void {
    localStorage.removeItem(AuthService.sessionKey);
    this.currentUser.set(null);
  }

  // Considera iniciada la sesión cuando la señal contiene un nombre de usuario.
  isAuthenticated(): boolean {
    return this.currentUser() !== null;
  }

  /** Deriva una clave PBKDF2 con una sal aleatoria de 16 bytes y 210 000 iteraciones. */
  private async hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' }, key, 256);
    // Guarda el esquema, las iteraciones, la sal y la clave para poder verificarla después.
    return `pbkdf2$210000$${this.toBase64(salt)}$${this.toBase64(new Uint8Array(bits))}`;
  }

  /** Reconstruye la clave con los parámetros guardados y compara sus bytes. */
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

  // Codifica los bytes de la sal y de la clave para incluirlos en el texto almacenado.
  private toBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
  }

  // Recupera los bytes originales a partir de un valor Base64.
  private fromBase64(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
}