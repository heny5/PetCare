import { Injectable, signal } from '@angular/core';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { BleClient, type ScanResult } from '@capacitor-community/bluetooth-le';
import { CapacitorNfc, type NfcEvent, type NdefRecord } from '@capgo/capacitor-nfc';

/** Datos que entrega la lectura NFC: identificador de la etiqueta y texto NDEF. */
export interface NfcReadResult {
  tagId: string;
  text: string;
}

/** Gestiona la búsqueda y conexión BLE, además de la lectura y escritura NFC. */
@Injectable({ providedIn: 'root' })
export class DeviceLinkService {
  // Cada búsqueda BLE permanece activa durante ocho segundos.
  private static readonly scanDurationMs = 8_000;
  private bleInitialized = false;
  private bleScanTimer: ReturnType<typeof setTimeout> | undefined;

  // Las señales permiten que la interfaz refleje dispositivos, conexión y operaciones activas.
  readonly bluetoothDevices = signal<ScanResult[]>([]);
  readonly isScanningBluetooth = signal(false);
  readonly connectedBluetoothDeviceId = signal('');
  readonly isNfcBusy = signal(false);

  /** Busca dispositivos BLE y actualiza la lista sin repetir identificadores. */
  async scanBluetooth(): Promise<void> {
    if (this.isScanningBluetooth()) return;

    this.bluetoothDevices.set([]);
    this.isScanningBluetooth.set(true);
    try {
      // Inicializa el cliente BLE una sola vez antes de solicitar el escaneo.
      if (!this.bleInitialized) {
        await BleClient.initialize();
        this.bleInitialized = true;
      }

      await BleClient.requestLEScan({ allowDuplicates: false }, (result) => {
        const devices = this.bluetoothDevices();
        // Si el dispositivo ya existe, reemplaza su resultado con los datos más recientes.
        const index = devices.findIndex((item) => item.device.deviceId === result.device.deviceId);
        if (index < 0) {
          this.bluetoothDevices.set([...devices, result]);
        } else {
          const updated = [...devices];
          updated[index] = result;
          this.bluetoothDevices.set(updated);
        }
      });

      // Espera la duración configurada antes de entrar en la limpieza del escaneo.
      await new Promise<void>((resolve) => {
        this.bleScanTimer = setTimeout(resolve, DeviceLinkService.scanDurationMs);
      });
    } finally {
      // Libera el temporizador y detiene el escaneo incluso si ocurrió un error.
      if (this.bleScanTimer !== undefined) {
        clearTimeout(this.bleScanTimer);
        this.bleScanTimer = undefined;
      }
      await BleClient.stopLEScan().catch(() => undefined);
      this.isScanningBluetooth.set(false);
    }
  }

  /** Conecta un dispositivo y desconecta primero cualquier enlace anterior. */
  async connectBluetooth(deviceId: string): Promise<void> {
    if (this.connectedBluetoothDeviceId() === deviceId) return;
    if (this.connectedBluetoothDeviceId()) {
      await this.disconnectBluetooth();
    }

    // El callback limpia el estado si el dispositivo conectado pierde el enlace.
    await BleClient.connect(deviceId, (disconnectedId) => {
      if (this.connectedBluetoothDeviceId() === disconnectedId) {
        this.connectedBluetoothDeviceId.set('');
      }
    });
    this.connectedBluetoothDeviceId.set(deviceId);
  }

  /** Cierra el enlace activo y limpia su identificador en la interfaz. */
  async disconnectBluetooth(): Promise<void> {
    const deviceId = this.connectedBluetoothDeviceId();
    if (!deviceId) return;
    await BleClient.disconnect(deviceId);
    this.connectedBluetoothDeviceId.set('');
  }

  /** Lee el primer registro de texto compatible y convierte el ID de la etiqueta a hexadecimal. */
  async readNfcTag(): Promise<NfcReadResult> {
    this.isNfcBusy.set(true);
    try {
      const event = await this.scanNfcTag('Acerca el teléfono a una etiqueta PetCare.');
      const text = event.tag.ndefMessage
        ?.map(decodeNdefText)
        .find((value): value is string => value !== null) ?? '';
      const tagId = event.tag.id?.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':')
        || 'Etiqueta sin identificador';
      return { tagId, text };
    } finally {
      this.isNfcBusy.set(false);
    }
  }

  /** Escribe el texto en un registro NDEF al detectar una etiqueta. */
  async writeNfcText(text: string): Promise<void> {
    this.isNfcBusy.set(true);
    try {
      await this.scanNfcTag('Acerca una etiqueta NFC para compartir la ficha de la mascota.', async () => {
        await CapacitorNfc.write({
          allowFormat: true,
          records: [createNdefTextRecord(text)],
        });
      });
    } finally {
      this.isNfcBusy.set(false);
    }
  }

  /** Abre una sesión NFC; onTag permite procesar la etiqueta antes de devolverla. */
  private async scanNfcTag(
    alertMessage: string,
    onTag?: (event: NfcEvent) => Promise<void>,
  ): Promise<NfcEvent> {
    // Comprueba que se ejecuta en un dispositivo nativo con NFC disponible y activado.
    if (!Capacitor.isNativePlatform()) {
      throw new Error('NFC requiere abrir PetCare en un dispositivo Android o iPhone compatible.');
    }

    const { supported } = await CapacitorNfc.isSupported();
    if (!supported) throw new Error('Este dispositivo no tiene NFC.');
    const { status } = await CapacitorNfc.getStatus();
    if (status === 'NFC_DISABLED') throw new Error('Activa NFC en los ajustes del dispositivo.');
    if (status !== 'NFC_OK') throw new Error('NFC no está disponible en este dispositivo.');

    let listener: PluginListenerHandle | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // Impide procesar varias veces la misma sesión o rechazarla después de detectar una etiqueta.
    let handled = false;
    let resolveEvent!: (event: NfcEvent) => void;
    let rejectEvent!: (error: Error) => void;
    const eventPromise = new Promise<NfcEvent>((resolve, reject) => {
      resolveEvent = resolve;
      rejectEvent = reject;
    });

    try {
      listener = await CapacitorNfc.addListener('nfcEvent', (event) => {
        if (handled) return;
        handled = true;
        void (async () => {
          await onTag?.(event);
          resolveEvent(event);
        })().catch((error: unknown) => {
          rejectEvent(error instanceof Error ? error : new Error('No se pudo procesar la etiqueta NFC.'));
        });
      });

      // Rechaza la espera si no se detecta una etiqueta en treinta segundos.
      timeout = setTimeout(() => {
        if (!handled) {
          handled = true;
          rejectEvent(new Error('No se detectó ninguna etiqueta. Vuelve a intentarlo.'));
        }
      }, 30_000);

      await CapacitorNfc.startScanning({
        alertMessage,
        iosSessionType: 'ndef',
        // La escritura conserva la sesión para ejecutar onTag; la lectura termina al leer.
        invalidateAfterFirstRead: !onTag,
      });
      return await eventPromise;
    } finally {
      // Retira el listener y cierra el escaneo tanto al completar como al fallar.
      if (timeout !== undefined) clearTimeout(timeout);
      await listener?.remove();
      await CapacitorNfc.stopScanning().catch(() => undefined);
    }
  }
}

/** Acepta registros de texto NDEF y omite el byte de estado y el código de idioma. */
function decodeNdefText(record: NdefRecord): string | null {
  if (record.tnf !== 1 || record.type[0] !== 0x54 || record.payload.length === 0) return null;
  const languageLength = record.payload[0] & 0x3f;
  // El bit superior del byte de estado determina si el texto usa UTF-16 o UTF-8.
  const encoding = record.payload[0] & 0x80 ? 'utf-16' : 'utf-8';
  return new TextDecoder(encoding).decode(Uint8Array.from(record.payload.slice(languageLength + 1)));
}

/** Construye un registro de texto UTF-8 con el código de idioma español. */
function createNdefTextRecord(text: string): NdefRecord {
  const language = Array.from(new TextEncoder().encode('es'));
  const content = Array.from(new TextEncoder().encode(text));
  return {
    tnf: 1,
    type: [0x54],
    id: [],
    // El payload contiene el byte de estado, el idioma y finalmente el texto codificado.
    payload: [language.length, ...language, ...content],
  };
}
