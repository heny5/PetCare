import { Component } from '@angular/core';
import { HomePage } from '../home/home.page';

@Component({
  selector: 'app-history-tab-page',
  template: '<app-home [initialView]="\'historial\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class HistoryTabPage {}
