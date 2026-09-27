import { Component } from '@angular/core';
import { HomePage } from '../home/home.page';

@Component({
  selector: 'app-nfc-tab-page',
  template: '<app-home [initialView]="\'nfc\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class NfcTabPage {}
