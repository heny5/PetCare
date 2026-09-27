import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { HomePage } from '../home/home.page';

@Component({
  selector: 'app-history-tab-page',
  template: '<app-home [initialView]="\'historial\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class HistoryTabPage implements AfterViewInit {
  @ViewChild(HomePage) private homePage?: HomePage;

  ngAfterViewInit(): void {
    this.homePage?.activarPestana('historial');
  }

  ionViewWillEnter(): void {
    this.homePage?.activarPestana('historial');
  }
}
