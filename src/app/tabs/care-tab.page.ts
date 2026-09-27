import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { HomePage } from '../home/home.page';

@Component({
  selector: 'app-care-tab-page',
  template: '<app-home [initialView]="\'cuidados\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class CareTabPage implements AfterViewInit {
  @ViewChild(HomePage) private homePage?: HomePage;

  ngAfterViewInit(): void {
    this.homePage?.activarPestana('cuidados');
  }

  ionViewWillEnter(): void {
    this.homePage?.activarPestana('cuidados');
  }
}
