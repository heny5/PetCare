import { Component } from '@angular/core';
import { HomePage } from '../home/home.page';

@Component({
  selector: 'app-home-tab-page',
  template: '<app-home [initialView]="\'inicio\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class HomeTabPage {}
