import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonBadge,
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonNote,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { CareRecordService } from '../services/care-record.service';
import { ConnectivityService } from '../services/connectivity.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    FormsModule,
    IonBadge,
    IonButton,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonNote,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
})
export class HomePage {
  petName = '';
  description = '';

  constructor(
    readonly connectivity: ConnectivityService,
    readonly careRecords: CareRecordService,
    private readonly toastController: ToastController,
  ) {}

  async saveCare(): Promise<void> {
    const petName = this.petName.trim();
    const description = this.description.trim();
    if (!petName || !description) {
      await this.showMessage('Completa el nombre de la mascota y el cuidado realizado.');
      return;
    }

    const result = await this.careRecords.save({ petName, description });
    this.petName = '';
    this.description = '';
    await this.showMessage(
      result === 'sent'
        ? 'Cuidado guardado y sincronizado.'
        : 'Cuidado guardado en este dispositivo. Se sincronizar\\u00e1 al recuperar la conexi\\u00f3n.',
    );
  }

  private async showMessage(message: string): Promise<void> {
    const localizedMessage = message
      .replaceAll(String.fromCharCode(92) + 'u00e1', String.fromCharCode(225))
      .replaceAll(String.fromCharCode(92) + 'u00f3', String.fromCharCode(243))
      .replaceAll('\\\\u00e1', String.fromCharCode(225))
      .replaceAll('\\\\u00f3', String.fromCharCode(243));
    const toast = await this.toastController.create({ message: localizedMessage, duration: 3200, position: 'bottom' });
    await toast.present();
  }
}
