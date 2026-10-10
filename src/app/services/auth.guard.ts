import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// Protege las rutas y conserva la dirección solicitada al redirigir al inicio de sesión.
export const requireAuthentication: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

// Lleva a la pantalla principal a quien ya tiene una sesión iniciada.
export const redirectAuthenticatedUser: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() ? inject(Router).createUrlTree(['/tabs/home']) : true;
};
