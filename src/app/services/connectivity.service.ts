import { Injectable, computed, signal } from '@angular/core';

/** Tracks browser connectivity and exposes a reactive value for the UI and sync queue. */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly onlineState = signal(typeof navigator === 'undefined' || navigator.onLine);

  readonly isOnline = computed(() => this.onlineState());

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.onlineState.set(true));
      window.addEventListener('offline', () => this.onlineState.set(false));
    }
  }
}
