import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonInput } from '@ionic/angular';
import { AuthService } from '../services/auth.service';

/** Formulario compartido para iniciar sesión o registrar una cuenta. */
@Component({
  selector: 'app-auth-page',
  templateUrl: './auth.page.html',
  styleUrl: './auth.page.scss',
  imports: [FormsModule, IonContent, IonInput],
})
export class AuthPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  // Las señales controlan el modo del formulario, sus campos y los mensajes de estado.
  readonly isRegister = signal(false);
  readonly username = signal('');
  readonly password = signal('');
  readonly phone = signal('');
  readonly error = signal('');
  readonly busy = signal(false);

  /** Valida los campos y ejecuta el registro o el inicio de sesión según el modo activo. */
  async submit(): Promise<void> {
    this.error.set('');
    // Usuario y contraseña siempre son obligatorios; el teléfono se exige al registrar.
    if (!this.username().trim() || !this.password() || (this.isRegister() && !this.phone().trim())) {
      this.error.set('Todos los campos son obligatorios.');
      return;
    }
    this.busy.set(true);
    try {
      if (this.isRegister()) {
        // Traduce los resultados de duplicidad en mensajes visibles para el usuario.
        const result = await this.auth.register(this.username(), this.password(), this.phone());
        if (result === 'phone-exists') this.error.set('Este número de teléfono ya tiene una cuenta registrada.');
        else if (result === 'username-exists') this.error.set('Este nombre de usuario ya está registrado.');
        else {
          // Al crear la cuenta, vuelve al ingreso y limpia contraseña y teléfono.
          this.isRegister.set(false);
          this.password.set('');
          this.phone.set('');
        }
      } else if (await this.auth.login(this.username(), this.password())) {
        await this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
      } else {
        this.error.set('Usuario o contraseña incorrectos');
      }
    } catch {
      this.error.set('No se pudo completar la operación. Inténtalo de nuevo.');
    } finally {
      // Restablece el estado del botón tanto si la operación termina como si falla.
      this.busy.set(false);
    }
  }

  // Alterna entre registro e ingreso y limpia el error de la operación anterior.
  toggleMode(): void {
    this.isRegister.update((value) => !value);
    this.error.set('');
  }
}
