import { Injectable, OnDestroy, computed, signal } from '@angular/core';

/** Shares real and simulated connectivity between the screen and the sync queue. */
@Injectable({ providedIn: 'root' })
export class ConnectivityService implements OnDestroy {
  readonly realOnline = signal(typeof navigator === 'undefined' || navigator.onLine);
  private readonly demoOnline = signal<boolean | null>(this.readDemoState());

  readonly isOnline = computed(() => this.demoOnline() ?? this.realOnline());
  readonly isDemoMode = computed(() => this.demoOnline() !== null);

  private readonly onOnline = () => this.updateNetworkStatus(true);
  private readonly onOffline = () => this.updateNetworkStatus(false);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
  }

  updateNetworkStatus(connected: boolean): void {
    this.realOnline.set(connected);
  }

  setDemoOnline(connected: boolean): void {
    localStorage.setItem('petcare-demo-online', JSON.stringify(connected));
    this.demoOnline.set(connected);
  }

  useRealNetwork(): void {
    localStorage.removeItem('petcare-demo-online');
    this.demoOnline.set(null);
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }

  private readDemoState(): boolean | null {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('petcare-demo-online') ?? 'null');
      return typeof value === 'boolean' ? value : null;
    } catch {
      return null;
    }
  }
}
