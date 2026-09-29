import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { CarePlanEntry } from './care-plan.model';

const notificationSource = 'petcare-care-plan';
const browserTimerLimitMs = 20 * 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class CareNotificationService {
  readonly enabled = signal(false);
  readonly supported = signal(true);
  readonly error = signal('');

  async refreshPermission(): Promise<boolean> {
    try {
      const permission = await LocalNotifications.checkPermissions();
      this.supported.set(true);
      this.enabled.set(permission.display === 'granted');
      return this.enabled();
    } catch {
      this.supported.set(false);
      this.enabled.set(false);
      return false;
    }
  }

  async requestPermission(): Promise<boolean> {
    this.error.set('');
    try {
      if (Capacitor.getPlatform() === 'android') {
        await LocalNotifications.createChannel({
          id: 'care-reminders',
          name: 'Recordatorios de cuidados',
          description: 'Avisos de alimentación, vacunas y otros cuidados de mascotas.',
          importance: 4,
        });
      }
      const permission = await LocalNotifications.requestPermissions();
      this.supported.set(true);
      this.enabled.set(permission.display === 'granted');
      if (!this.enabled()) this.error.set('No se concedió permiso para mostrar notificaciones. Puedes activarlo en los ajustes del dispositivo.');
      return this.enabled();
    } catch {
      this.supported.set(false);
      this.enabled.set(false);
      this.error.set('Las notificaciones no están disponibles en este dispositivo o navegador.');
      return false;
    }
  }

  async sync(owner: string, entries: CarePlanEntry[]): Promise<void> {
    if (!owner || !(await this.refreshPermission())) return;

    try {
      const pending = await LocalNotifications.getPending();
      const existing = pending.notifications.filter((item) =>
        item.extra?.source === notificationSource && item.extra?.owner === owner
      );
      if (existing.length) {
        await LocalNotifications.cancel({ notifications: existing.map(({ id }) => ({ id })) });
      }

      const now = Date.now();
      const horizon = Capacitor.isNativePlatform() ? 365 * 24 * 60 * 60 * 1000 : browserTimerLimitMs;
      const upcoming = entries
        .filter((entry) => entry.status === 'pending')
        .filter((entry) => entry.reminderEnabled !== false)
        .filter((entry) => {
          const dueAt = Date.parse(entry.dueAt);
          return Number.isFinite(dueAt) && dueAt > now && dueAt - now <= horizon;
        })
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
        .slice(0, 60);

      if (!upcoming.length) return;
      await LocalNotifications.schedule({
        notifications: upcoming.map((entry) => ({
          id: this.notificationId(owner, entry.id),
          title: `${entry.type}: ${entry.petName}`,
          body: [entry.title, entry.quantity, entry.details].filter(Boolean).join(' · ').slice(0, 240),
          schedule: { at: new Date(entry.dueAt), allowWhileIdle: true },
          channelId: 'care-reminders',
          extra: { source: notificationSource, owner, carePlanId: entry.id },
        })),
      });
      this.error.set('');
    } catch {
      this.error.set('No se pudieron actualizar los avisos programados. Revisa los permisos de notificación.');
    }
  }

  private notificationId(owner: string, carePlanId: string): number {
    let hash = 2166136261;
    for (const character of `${owner}:${carePlanId}`) {
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    }
    return (hash >>> 0) % 2_147_483_646 + 1;
  }
}
