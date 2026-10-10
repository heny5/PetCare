import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { HomePage } from '../home/home.page';

/** Reutiliza HomePage para el historial de cuidados y el álbum de videos. */
@Component({
  selector: 'app-history-tab-page',
  template: '<app-home [initialView]="\'historial\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class HistoryTabPage implements AfterViewInit {
  @ViewChild(HomePage) private homePage?: HomePage;

  // Prepara el historial cuando el componente hijo ya está creado.
  ngAfterViewInit(): void {
    this.homePage?.activarPestana('historial');
  }

  // Actualiza la vista y su mascota seleccionada al volver a la pestaña.
  ionViewWillEnter(): void {
    this.homePage?.activarPestana('historial');
  }
}
