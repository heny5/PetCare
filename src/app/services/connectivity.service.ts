import { Injectable, OnDestroy, computed, signal } from '@angular/core';

/** Shares the device's real connectivity between the screen and the sync queue. */
/** Centraliza el estado de conexión que consultan la pantalla y la sincronización. */
@Injectable({ providedIn: 'root' })
export class ConnectivityService implements OnDestroy {
  // Usa el estado inicial del navegador; sin navigator, el valor inicial es conectado.
  readonly realOnline = signal(typeof navigator === 'undefined' || navigator.onLine);
  // Expone el estado como una señal calculada para sus consumidores.
  readonly isOnline = computed(() => this.realOnline());

  // Conserva las referencias de los callbacks para poder retirar los mismos listeners.
  private readonly onOnline = () => this.updateNetworkStatus(true);
  private readonly onOffline = () => this.updateNetworkStatus(false);

  // Escucha cambios de red y elimina un valor antiguo de conexión de demostración.
  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem('petcare-demo-online');
    } catch {
      // Connectivity detection does not depend on browser storage.
    }
  }

  // También recibe el estado detectado por el plugin Network de Capacitor.
  updateNetworkStatus(connected: boolean): void {
    this.realOnline.set(connected);
  }

  // Retira los listeners cuando Angular destruye el servicio.
  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }
}
