import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-auth-page',
  templateUrl: './auth.page.html',
  styleUrl: './auth.page.scss',
  imports: [FormsModule, IonContent],
})
export class AuthPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly isRegister = signal(false);
  readonly username = signal('');
  readonly password = signal('');
  readonly phone = signal('');
  readonly error = signal('');
  readonly busy = signal(false);

  async submit(): Promise<void> {
    this.error.set('');
    if (!this.username().trim() || !this.password() || (this.isRegister() && !this.phone().trim())) {
      this.error.set('Todos los campos son obligatorios.');
      return;
    }
    this.busy.set(true);
    try {
      if (this.isRegister()) {
        const result = await this.auth.register(this.username(), this.password(), this.phone());
        if (result === 'phone-exists') this.error.set('Este número de teléfono ya tiene una cuenta registrada.');
        else if (result === 'username-exists') this.error.set('Este nombre de usuario ya está registrado.');
        else {
          this.isRegister.set(false);
          this.password.set('');
          this.phone.set('');
        }
      } else if (await this.auth.login(this.username(), this.password())) {
        await this.router.navigateByUrl('/home', { replaceUrl: true });
      } else {
        this.error.set('Usuario o contraseña incorrectos');
      }
    } catch {
      this.error.set('No se pudo completar la operación. Inténtalo de nuevo.');
    } finally {
      this.busy.set(false);
    }
  }

  toggleMode(): void {
    this.isRegister.update((value) => !value);
    this.error.set('');
  }
}