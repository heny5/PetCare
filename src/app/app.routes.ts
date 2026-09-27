import { Routes } from '@angular/router';
import { redirectAuthenticatedUser, requireAuthentication } from './services/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [redirectAuthenticatedUser],
    loadComponent: () => import('./auth/auth.page').then((m) => m.AuthPage),
  },
  {
    path: 'tabs',
    canActivate: [requireAuthentication],
    loadComponent: () => import('./tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      {
        path: 'home',
        loadComponent: () => import('./tabs/home-tab.page').then((m) => m.HomeTabPage),
      },
      {
        path: 'pets',
        loadComponent: () => import('./tabs/pets-tab.page').then((m) => m.PetsTabPage),
      },
      {
        path: 'nfc',
        loadComponent: () => import('./tabs/nfc-tab.page').then((m) => m.NfcTabPage),
      },
      {
        path: 'history',
        loadComponent: () => import('./tabs/history-tab.page').then((m) => m.HistoryTabPage),
      },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },
  {
    path: 'home',
    redirectTo: 'tabs/home',
    pathMatch: 'full',
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
