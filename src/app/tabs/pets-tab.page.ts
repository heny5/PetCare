import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { HomePage } from '../home/home.page';

@Component({
  selector: 'app-pets-tab-page',
  template: '<app-home [initialView]="\'mascotas\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class PetsTabPage implements AfterViewInit {
  @ViewChild(HomePage) private homePage?: HomePage;

  ngAfterViewInit(): void {
    this.homePage?.activarPestana('mascotas');
  }

  ionViewWillEnter(): void {
    this.homePage?.activarPestana('mascotas');
  }
}
