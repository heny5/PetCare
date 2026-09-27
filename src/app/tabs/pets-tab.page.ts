import { Component } from '@angular/core';
import { HomePage } from '../home/home.page';

@Component({
  selector: 'app-pets-tab-page',
  template: '<app-home [initialView]="\'mascotas\'"></app-home>',
  styleUrls: ['./tab-page.scss'],
  imports: [HomePage],
})
export class PetsTabPage {}
