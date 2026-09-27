import { Injectable, OnDestroy, computed, signal } from '@angular/core';

/** Shares the device's real connectivity between the screen and the sync queue. */
@Injectable({ providedIn: 'root' })
export class ConnectivityService implements OnDestroy {
  readonly realOnline = signal(typeof navigator === 'undefined' || navigator.onLine);
  readonly isOnline = computed(() => this.realOnline());

  private readonly onOnline = () => this.updateNetworkStatus(true);
  private readonly onOffline = () => this.updateNetworkStatus(false);

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

  updateNetworkStatus(connected: boolean): void {
    this.realOnline.set(connected);
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }
}
