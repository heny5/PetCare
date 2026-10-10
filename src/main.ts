import { defineCustomElements } from 'jeep-sqlite/loader';
import { bootstrapApplication } from '@angular/platform-browser';
import { Capacitor } from '@capacitor/core';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';

/** Prepara el soporte de almacenamiento web antes de iniciar Angular e Ionic. */
async function startApp(): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    // Registra jeep-sqlite, necesario para el almacenamiento SQLite en el navegador.
    await defineCustomElements(window);
    await customElements.whenDefined('jeep-sqlite');

    // Keep this third-party Stencil element outside Ionic's component tree.
    // Ionic and jeep-sqlite ship separate Stencil runtimes.
    if (!document.querySelector('jeep-sqlite')) {
      const jeepSqlite = document.createElement('jeep-sqlite');
      // El componente de almacenamiento no tiene contenido visible para el usuario.
      jeepSqlite.hidden = true;
      document.body.appendChild(jeepSqlite);
    }
  }

  await bootstrapApplication(AppComponent, {
    providers: [
      { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
      provideIonicAngular(),
      provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    ],
  });
}

void startApp().catch((error: unknown) => console.error('No se pudo iniciar PetCare.', error));
