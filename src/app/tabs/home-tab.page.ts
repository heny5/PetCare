import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { HomePage } from '../home/home.page';

@Component({
  selector: 'app-home-tab-page',
  template: '<app-home [initialView]="\'inicio\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class HomeTabPage implements AfterViewInit {
  @ViewChild(HomePage) private homePage?: HomePage;

  ngAfterViewInit(): void {
    this.homePage?.activarPestana('inicio');
  }

  ionViewWillEnter(): void {
    this.homePage?.activarPestana('inicio');
  }
}
