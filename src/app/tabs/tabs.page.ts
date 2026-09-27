import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  Gesture,
  GestureController,
  IonIcon,
  IonLabel,
  IonTabBar,
  IonTabButton,
  IonTabs,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { calendarOutline, homeOutline, pawOutline, radioOutline, timeOutline } from 'ionicons/icons';

const TAB_ROUTES = ['/tabs/home', '/tabs/pets', '/tabs/care', '/tabs/nfc', '/tabs/history'] as const;

@Component({
  selector: 'app-tabs',
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
})
export class TabsPage implements AfterViewInit, OnDestroy {
  @ViewChild('gestureSurface', { read: ElementRef })
  private gestureSurface?: ElementRef<HTMLElement>;

  private readonly router = inject(Router);
  private readonly gestureController = inject(GestureController);
  private pageSwipe?: Gesture;

  constructor() {
    addIcons({ calendarOutline, homeOutline, pawOutline, radioOutline, timeOutline });
  }

  ngAfterViewInit(): void {
    const surface = this.gestureSurface?.nativeElement;
    if (!surface) return;

    this.pageSwipe = this.gestureController.create({
      el: surface,
      gestureName: 'petcare-tab-swipe',
      direction: 'x',
      threshold: 25,
      maxAngle: 25,
      canStart: ({ event }) => {
        const target = event.target;
        return !(target instanceof Element && target.closest(
          'button, a, input, textarea, select, [contenteditable="true"], ion-button, ion-input, ion-select, ion-range, ion-searchbar, ion-segment, ion-tab-bar, .leaflet-container'
        ));
      },
      onEnd: ({ deltaX }) => {
        if (Math.abs(deltaX) < 60) return;

        const currentIndex = TAB_ROUTES.findIndex((path) => this.router.url.startsWith(path));
        if (currentIndex < 0) return;

        const nextIndex = currentIndex + (deltaX < 0 ? 1 : -1);
        if (nextIndex >= 0 && nextIndex < TAB_ROUTES.length) {
          void this.router.navigateByUrl(TAB_ROUTES[nextIndex]);
        }
      },
    }, true);
  }

  ngOnDestroy(): void {
    this.pageSwipe?.destroy();
  }
}
