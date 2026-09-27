import { Routes } from '@angular/router';
import { redirectAuthenticatedUser, requireAuthentication } from './services/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [redirectAuthenticatedUser],
    loadComponent: () => import('./auth/auth.page').then((m) => m.AuthPage),
  },
  {
    path: 'home',
    canActivate: [requireAuthentication],
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'location',
    canActivate: [requireAuthentication],
    loadComponent: () => import('./location/location.page').then( m => m.LocationPage)
  },

];
