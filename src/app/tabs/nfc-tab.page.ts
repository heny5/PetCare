import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { HomePage } from '../home/home.page';

@Component({
  selector: 'app-nfc-tab-page',
  template: '<app-home [initialView]="\'nfc\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class NfcTabPage implements AfterViewInit {
  @ViewChild(HomePage) private homePage?: HomePage;

  ngAfterViewInit(): void {
    this.homePage?.activarPestana('nfc');
  }

  ionViewWillEnter(): void {
    this.homePage?.activarPestana('nfc');
  }
}
