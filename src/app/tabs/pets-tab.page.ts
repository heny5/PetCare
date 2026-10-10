import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { HomePage } from '../home/home.page';

/** Reutiliza HomePage para presentar el módulo de mascotas en su pestaña. */
@Component({
  selector: 'app-pets-tab-page',
  template: '<app-home [initialView]="\'mascotas\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class PetsTabPage implements AfterViewInit {
  @ViewChild(HomePage) private homePage?: HomePage;

  // Activa la vista de mascotas una vez disponible el componente hijo.
  ngAfterViewInit(): void {
    this.homePage?.activarPestana('mascotas');
  }

  // Vuelve a activar sus datos cada vez que se entra en esta pestaña.
  ionViewWillEnter(): void {
    this.homePage?.activarPestana('mascotas');
  }
}
