import { CommonModule } from '@angular/common';
import {
  Component,
  ChangeDetectorRef,
  OnChanges,
  OnDestroy,
  OnInit,
  Input,
  ElementRef,
  QueryList,
  ViewChildren,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  Network,
  ConnectionStatus
} from '@capacitor/network';
import type {
  PluginListenerHandle
} from '@capacitor/core';

import { Camera, CameraErrorCode, EncodingType, MediaType, MediaTypeSelection } from '@capacitor/camera';
import { DeviceLinkService, type NfcReadResult } from '../services/device-link.service';
import {
  IonContent,
  IonIcon,
  IonPopover,
  IonRefresher,
  IonRefresherContent,
  RefresherCustomEvent,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { personCircleOutline } from 'ionicons/icons';

import { PetService } from '../services/pet.service';
import { PET_SPECIES, PET_SEXES, PetDraft, StoredPet, isPetDraft } from '../services/pet.model';
import { CARE_ACTIVITY_TYPES, CareActivityType, CareRecordService } from '../services/care-record.service';
import { CarePlanService } from '../services/care-plan.service';
import { CARE_PLAN_TYPES, CarePlanDraft, CarePlanEntry, CarePlanType } from '../services/care-plan.model';
import { DatabaseService } from '../services/database.service';
import { ConnectivityService } from '../services/connectivity.service';
import { AuthService } from '../services/auth.service';
import { PetMediaService, PetVideoClip } from '../services/pet-media.service';
import * as QRCode from 'qrcode';

type Vista =
  | 'inicio'
  | 'mascotas'
  | 'nueva-mascota'
  | 'detalle'
  | 'conectar'
  | 'sensor'
  | 'nfc'
  | 'cuidados'
  | 'historial'
  | 'alertas'
  | 'compartir';

interface AlertaCollar {
  id: number;
  tipo:
    | 'critica'
    | 'advertencia'
    | 'informativa';
  titulo: string;
  detalle: string;
  hora: string;
  revisada: boolean;
}

interface HistorialEvent {
  id: string;
  category: string;
  title: string;
  details: string;
  occurredAt: string;
  pendingSync: boolean;
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonIcon,
    IonPopover,
    IonRefresher,
    IonRefresherContent,
    RouterLink
  ],
})
export class HomePage implements OnChanges, OnInit, OnDestroy {
  @Input({ required: true }) initialView!: Vista;

  readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  vista: Vista = 'inicio';

  readonly nfcReadResult = signal<NfcReadResult | null>(null);
  readonly nfcSharedPet = signal<{ id: string; name: string; species: string; breed: string } | null>(null);
  readonly nfcMatchedPet = signal<StoredPet | undefined>(undefined);
  readonly careRecords = inject(CareRecordService);
  readonly carePlan = inject(CarePlanService);
  readonly petMedia = inject(PetMediaService);
  readonly videoAlbumOpen = signal(false);
  readonly selectedVideoId = signal('');
  readonly selectedVideo = computed(() =>
    this.petMedia.clips().find((clip) => clip.id === this.selectedVideoId())
  );
  readonly activityTypes = CARE_ACTIVITY_TYPES;
  readonly historialMascotaId = signal('');
  readonly mascotaHistorialSeleccionada = computed(() =>
    this.petStore.pets().find((pet) => pet.id === this.historialMascotaId())
  );
  readonly historialMascota = computed<HistorialEvent[]>(() => {
    const pet = this.mascotaHistorialSeleccionada();
    const owner = this.auth.currentUser()?.trim().toLocaleLowerCase();
    if (!pet || !owner) return [];
    const belongsToPet = (record: { petName: string; petId?: string; owner?: string }) => {
      if (record.owner && record.owner.trim().toLocaleLowerCase() !== owner) return false;
      if (record.petId) return record.petId === pet.id;
      return record.petName.trim().toLocaleLowerCase() === pet.name.trim().toLocaleLowerCase();
    };
    const events = new Map<string, HistorialEvent>();
    for (const record of this.careRecords.serverRecords()) {
      if (!belongsToPet(record)) continue;
      events.set(record.id, {
        id: record.id, category: record.category ?? 'Otro', title: record.category ?? 'Atención',
        details: record.description, occurredAt: record.createdAt, pendingSync: false,
      });
    }
    for (const record of this.careRecords.pendingRecords()) {
      if (!belongsToPet(record)) continue;
      events.set(record.id, {
        id: record.id, category: record.category ?? 'Otro', title: record.category ?? 'Atención',
        details: record.description, occurredAt: record.createdAt, pendingSync: true,
      });
    }
    for (const entry of this.carePlan.completedEntries()) {
      if (entry.petId !== pet.id) continue;
      const measurements = [
        entry.weightKg === null ? '' : `Peso: ${entry.weightKg} kg`,
        entry.temperatureC === null ? '' : `Temperatura: ${entry.temperatureC} °C`,
      ].filter(Boolean);
      events.set(`plan:${entry.id}`, {
        id: `plan:${entry.id}`, category: entry.type, title: entry.title,
        details: [entry.details, ...measurements].filter(Boolean).join(' · '),
        occurredAt: entry.completedAt ?? entry.dueAt, pendingSync: false,
      });
    }
    return [...events.values()].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  });
  readonly historialPendientesCount = computed(() =>
    this.historialMascota().filter((event) => event.pendingSync).length
  );
  readonly carePlanTypes = CARE_PLAN_TYPES;
  private readonly database = inject(DatabaseService);
  readonly nextCareItems = computed(() => this.carePlan.pendingEntries().slice(0, 2));
  readonly deviceLink = inject(DeviceLinkService);
  readonly petStore = inject(PetService);
  readonly totalPendientes = computed(() => this.careRecords.pendingCount() + this.petStore.pendingCount());
  readonly especies = PET_SPECIES;
  readonly sexos = PET_SEXES;
  readonly errorMascota = signal('');
  readonly avisoMascota = signal('');
  readonly fotosMascota = signal<Record<string, string>>(this.leerFotosMascota());
  readonly errorFoto = signal('');
  readonly opcionesFotoAbiertas = signal(false);
  readonly usuarioMenuAbierto = signal(false);
  private readonly mascotaId = signal('');
  readonly mascotaSeleccionada = computed<StoredPet | undefined>(() =>
    this.petStore.pets().find((pet) => pet.id === this.mascotaId()) ?? this.petStore.pets()[0]
  );
  nuevaMascota: PetDraft = this.formularioMascotaVacio();
  editandoMascotaId: string | null = null;
  mascotaPorEliminar: StoredPet | null = null;
  private readonly connectivity = inject(ConnectivityService);
  private readonly mensajeLocal = signal('');
  readonly guardando = signal(false);
  private readonly registrosPendientes = computed(() =>
    this.careRecords.pendingRecords().map((record) => ({
      id: record.id,
      tipo: `Cuidado de ${record.petName}`,
      detalle: record.description,
      fecha: record.createdAt,
    }))
  );

  get mensaje(): string { return this.mensajeLocal(); }
  set mensaje(value: string) { this.mensajeLocal.set(value); }
  get enLinea(): boolean { return this.connectivity.isOnline(); }
  get sincronizando(): boolean { return this.careRecords.isSynchronizing(); }
  get pendientes() { return this.registrosPendientes(); }
  get buscandoBluetooth(): boolean { return this.deviceLink.isScanningBluetooth(); }
  get dispositivoEncontrado(): boolean { return this.deviceLink.bluetoothDevices().length > 0; }
  get dispositivoConectado(): boolean { return this.deviceLink.connectedBluetoothDeviceId().length > 0; }
  get nombreDispositivoConectado(): string {
    const id = this.deviceLink.connectedBluetoothDeviceId();
    const result = this.deviceLink.bluetoothDevices().find((item) => item.device.deviceId === id);
    return result?.device.name || result?.localName || 'Dispositivo BLE';
  }
  get ultimaSincronizacion(): string {
    const fecha = this.careRecords.lastSyncedAt();
    return fecha ? new Date(fecha).toLocaleTimeString('es-DO', {
      hour: '2-digit', minute: '2-digit',
    }) : '';
  }

  mascotaPerdida = false;
  fechaAlertaPerdida = '';
  readonly lostPetQr = signal('');
  readonly lostQrLoading = signal(false);
  readonly lostQrError = signal('');

  carePlanPetId = '';
  carePlanType: CarePlanType = 'Cita veterinaria';
  carePlanTitle = '';
  carePlanDetails = '';
  carePlanDueAt = this.fechaLocalInput(24 * 60 * 60 * 1000);
  carePlanWeight: number | null = null;
  carePlanTemperature: number | null = null;
  readonly carePlanMessage = signal('');
  readonly savingCarePlan = signal(false);

  nombreMascota = '';
  cuidadoRealizado = '';
  historyCategory: CareActivityType = 'Otro';
  videoCaption = '';
  readonly videoMessage = signal('');
  readonly savingVideo = signal(false);
  readonly playingVideoId = signal('');
  readonly videoPositions = signal<Record<string, number>>({});
  @ViewChildren('petVideoPlayer') private petVideoPlayers?: QueryList<ElementRef<HTMLVideoElement>>;

  alertas: AlertaCollar[] = [
    {
      id: 1,
      tipo: 'critica',
      titulo: 'Temperatura elevada',
      detalle:
        'Se detectaron 39.4 °C durante 5 minutos.',
      hora: 'Hoy · 2:18 p. m.',
      revisada: false
    },
    {
      id: 2,
      tipo: 'advertencia',
      titulo: 'Batería baja',
      detalle:
        'El collar tiene 18% de batería disponible.',
      hora: 'Hoy · 1:42 p. m.',
      revisada: false
    },
    {
      id: 3,
      tipo: 'informativa',
      titulo:
        'Actividad fuera de lo normal',
      detalle:
        'La mascota permaneció inactiva más tiempo de lo habitual.',
      hora: 'Ayer · 9:10 p. m.',
      revisada: true
    }
  ];

  private networkListener?: PluginListenerHandle;
  private destroyed = false;

  constructor() {
    addIcons({ personCircleOutline });
    effect(() => {
      const pets = this.petStore.pets();
      if (pets.length && !pets.some((pet) => pet.id === this.carePlanPetId)) {
        this.carePlanPetId = this.mascotaSeleccionada()?.id ?? pets[0].id;
      }
    });
    effect(() => {
      const pets = this.petStore.pets();
      if (this.vista === 'historial' && pets.length && !pets.some((pet) => pet.id === this.historialMascotaId())) {
        this.prepararMascotaHistorial();
      }
    });
    effect(() => {
      const synchronizing = this.careRecords.isSynchronizing();
      const pending = this.careRecords.pendingCount();
      const error = this.careRecords.syncError();
      const lastSync = this.careRecords.lastSyncedAt();
      const online = this.enLinea;
      if (this.careRecords.migrationError()) {
        this.mensaje = 'Algunos registros anteriores no pudieron recuperarse. Se conservaron en este dispositivo.';
      } else if (synchronizing) {
        this.mensaje = 'Sincronizando cuidados…';
      } else if (pending && !online) {
        this.mensaje = 'Registro guardado en el dispositivo. Se sincronizará cuando regrese internet.';
      } else if (error) {
        this.mensaje = 'No fue posible contactar la API. Los registros siguen guardados; se reintentará en 15 segundos.';
      } else if (!pending && lastSync) {
        this.mensaje = 'Sincronización completada correctamente.';
      }
    });
  }

  async ngOnInit(): Promise<void> {
    this.cargarEstadoLocal();
    if (this.initialView === 'inicio' || this.initialView === 'cuidados' || this.initialView === 'historial') this.petStore.activate();
    if (this.initialView === 'inicio') void this.carePlan.activate();
    if (this.initialView === 'cuidados') {
      void this.carePlan.activate();
      this.prepararFormularioCuidados();
    }
    if (this.initialView === 'historial') {
      void this.carePlan.activate();
      this.prepararMascotaHistorial();
      void this.careRecords.loadRecords();
    }
    try {
      const estado = await Network.getStatus();
      if (this.destroyed) return;
      this.actualizarEstadoRed(estado);
      const listener = await Network.addListener('networkStatusChange', (status) => {
        this.actualizarEstadoRed(status);
      });
      if (this.destroyed) {
        await listener.remove();
      } else {
        this.networkListener = listener;
      }
    } catch {
      // ConnectivityService also follows browser online/offline events.
    }
  }

  async ngOnDestroy(): Promise<void> {
    this.destroyed = true;
    await this.networkListener?.remove();
  }

  async cerrarSesion(popover: IonPopover): Promise<void> {
    await popover.dismiss();
    this.usuarioMenuAbierto.set(false);
    this.auth.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }


  abrir(vista: Vista): void {
    this.mascotaPorEliminar = null;
    this.vista = vista;
    this.mensaje = '';
    if (vista === 'mascotas' || vista === 'nfc') this.petStore.activate();
    if (vista === 'cuidados') {
      this.petStore.activate();
      void this.carePlan.activate();
      this.prepararFormularioCuidados();
    }
    if (vista === 'inicio') void this.carePlan.activate();
    if (vista === 'historial') {
      this.petStore.activate();
      void this.carePlan.activate();
      this.prepararMascotaHistorial();
      void this.careRecords.loadRecords();
    }

    const tabRoute: Partial<Record<Vista, string>> = {
      inicio: '/tabs/home',
      mascotas: '/tabs/pets',
      cuidados: '/tabs/care',
      nfc: '/tabs/nfc',
      historial: '/tabs/history',
    };
    const destination = tabRoute[vista];
    if (destination && this.router.url !== destination) {
      void this.router.navigateByUrl(destination);
    }
  }

  ngOnChanges(): void {
    if (!this.initialView) return;
    this.activarPestana(this.initialView);
  }

  activarPestana(vista: Vista): void {
    this.vista = vista;
    this.mascotaPorEliminar = null;
    if (vista === 'mascotas' || vista === 'nfc') this.petStore.activate();
    if (vista === 'inicio') void this.carePlan.activate();
    if (vista === 'cuidados') {
      this.petStore.activate();
      void this.carePlan.activate();
      this.prepararFormularioCuidados();
    }
    if (vista === 'historial') {
      this.petStore.activate();
      void this.carePlan.activate();
      this.prepararMascotaHistorial();
      void this.careRecords.loadRecords();
    }
  }

  async actualizarContenido(event: RefresherCustomEvent): Promise<void> {
    try {
      await Promise.allSettled([
        this.petStore.sync(),
        this.careRecords.syncPending(),
        this.careRecords.loadRecords(),
        this.carePlan.reload(),
      ]);
    } finally {
      await event.detail.complete();
    }
  }

  abrirFormularioMascota(): void {
    this.editandoMascotaId = null;
    this.nuevaMascota = this.formularioMascotaVacio();
    this.errorMascota.set('');
    this.avisoMascota.set('');
    this.abrir('nueva-mascota');
  }

  async registrarMascota(form: NgForm): Promise<void> {
    if (this.vista !== 'nueva-mascota') return;
    this.errorMascota.set('');
    if (form.invalid || !isPetDraft(this.nuevaMascota)) {
      this.errorMascota.set('Completa los campos obligatorios y revisa la edad y el peso.');
      return;
    }
    try {
      const pet = await (this.editandoMascotaId
        ? this.petStore.update(this.editandoMascotaId, this.nuevaMascota)
        : this.petStore.add(this.nuevaMascota));
      this.avisoMascota.set(this.editandoMascotaId ? `Se actualizaron los datos de ${pet.name}.` : `${pet.name} se añadió a tus mascotas.`);
      this.abrir('mascotas');
      this.changeDetector.detectChanges();
    } catch {
      this.errorMascota.set('No se pudo guardar la mascota en este dispositivo. Conserva los datos e inténtalo de nuevo.');
      this.changeDetector.detectChanges();
    }
  }

  seleccionarMascota(pet: StoredPet | undefined): void {
    if (!pet) { this.abrir('mascotas'); return; }
    this.mascotaId.set(pet.id);
    this.errorFoto.set('');
    this.opcionesFotoAbiertas.set(false);
    this.nombreMascota = pet.name;
    this.cargarEstadoMascotaPerdida(pet);
    this.abrir('detalle');
  }

  alternarOpcionesFoto(): void {
    this.errorFoto.set('');
    this.opcionesFotoAbiertas.update((abiertas) => !abiertas);
  }

  agregarFotoGaleria(): Promise<void> {
    return this.cambiarFoto('galeria');
  }

  tomarFoto(): Promise<void> {
    return this.cambiarFoto('camara');
  }

  private async cambiarFoto(origen: 'galeria' | 'camara'): Promise<void> {
    const mascota = this.mascotaSeleccionada();
    if (!mascota) return;
    this.errorFoto.set('');
    try {
      const imagen = origen === 'camara'
        ? await Camera.takePhoto({
            quality: 82,
            targetWidth: 640,
            targetHeight: 640,
            encodingType: EncodingType.JPEG,
            editable: 'in-app',
            includeMetadata: true,
          })
        : (await Camera.chooseFromGallery({
            mediaType: MediaTypeSelection.Photo,
            quality: 82,
            editable: 'in-app',
            includeMetadata: true,
          })).results[0];
      if (!imagen?.thumbnail) throw new Error('No se recibió la imagen.');
      const formato = imagen.metadata?.format === 'png' ? 'png' : 'jpeg';
      const foto = `data:image/${formato};base64,${imagen.thumbnail}`;
      const fotos = { ...this.fotosMascota(), [mascota.id]: foto };
      localStorage.setItem('petcare.fotos-mascotas', JSON.stringify(fotos));
      this.fotosMascota.set(fotos);
      this.opcionesFotoAbiertas.set(false);
    } catch (error) {
      const codigo = typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
      if (codigo === CameraErrorCode.TakePhotoCancelled || codigo === CameraErrorCode.ChooseMediaCancelled) return;
      this.errorFoto.set('No se pudo guardar la foto. Prueba con otra imagen.');
    }
  }

  private leerFotosMascota(): Record<string, string> {
    try {
      const fotos: unknown = JSON.parse(localStorage.getItem('petcare.fotos-mascotas') ?? '{}');
      return fotos && typeof fotos === 'object' && !Array.isArray(fotos)
        ? fotos as Record<string, string>
        : {};
    } catch {
      return {};
    }
  }


  editarMascota(pet: StoredPet): void {
    this.editandoMascotaId = pet.id;
    this.nuevaMascota = {
      name: pet.name, species: pet.species, breed: pet.breed,
      sex: pet.sex, ageYears: pet.ageYears, weightKg: pet.weightKg,
    };
    this.errorMascota.set('');
    this.avisoMascota.set('');
    this.abrir('nueva-mascota');
  }

  solicitarEliminarMascota(pet: StoredPet): void {
    this.errorMascota.set('');
    this.avisoMascota.set('');
    this.mascotaPorEliminar = pet;
  }

  async eliminarMascota(): Promise<void> {
    const pet = this.mascotaPorEliminar;
    if (!pet) return;
    try {
      await this.petStore.remove(pet.id);
      this.avisoMascota.set(`${pet.name} se eliminó de tus mascotas.`);
      this.abrir('mascotas');
      this.changeDetector.detectChanges();
    } catch {
      this.errorMascota.set('No se pudo eliminar la mascota. Inténtalo de nuevo.');
      this.changeDetector.detectChanges();
    }
  }

  abrirCuidadosMascota(): void {
    const pet = this.mascotaSeleccionada();
    if (!pet) { this.abrir('mascotas'); return; }
    this.nombreMascota = pet.name;
    this.carePlanPetId = pet.id;
    this.abrir('cuidados');
  }

  iconoMascota(species: string): string {
    return ({ Perro: '🐕', Gato: '🐈', Ave: '🐦', Conejo: '🐇' } as Record<string, string>)[species] ?? '🐾';
  }

  edadMascota(age: number | null): string {
    if (age === null) return 'Edad sin especificar';
    if (age === 0) return 'Menos de 1 año';
    return `${age} ${age === 1 ? 'año' : 'años'}`;
  }

  private formularioMascotaVacio(): PetDraft {
    return { name: '', species: 'Perro', breed: '', sex: 'Sin especificar', ageYears: null, weightKg: null };
  }

  async conectar(deviceId: string): Promise<void> {
    try {
      await this.deviceLink.connectBluetooth(deviceId);
      this.mensaje = `Conectado a ${this.nombreDispositivoConectado}.`;
    } catch {
      this.mensaje = 'No se pudo conectar a este dispositivo Bluetooth LE.';
    }
  }

  async buscarDispositivos(): Promise<void> {
    this.mensaje = 'Buscando dispositivos Bluetooth LE cercanos…';
    try {
      await this.deviceLink.scanBluetooth();
      const total = this.deviceLink.bluetoothDevices().length;
      this.mensaje = total
        ? `Se encontraron ${total} dispositivo(s) Bluetooth LE.`
        : 'No se encontraron dispositivos. Acerca el collar e inténtalo de nuevo.';
    } catch {
      this.mensaje = 'No se pudo iniciar el escaneo Bluetooth. Revisa que Bluetooth esté activo y vuelve a intentar.';
    }
  }

  async desconectar(): Promise<void> {
    try {
      await this.deviceLink.disconnectBluetooth();
      this.mensaje = 'Dispositivo Bluetooth desconectado.';
      this.agregarAlertaDesconexion();
    } catch {
      this.mensaje = 'No se pudo desconectar el dispositivo Bluetooth.';
    }
  }

  async leerEtiquetaNfc(): Promise<void> {
    this.nfcReadResult.set(null);
    this.nfcSharedPet.set(null);
    this.nfcMatchedPet.set(undefined);
    try {
      const result = await this.deviceLink.readNfcTag();
      this.nfcReadResult.set(result);
      const profile = this.parseNfcPetProfile(result.text);
      if (!profile) {
        this.mensaje = result.text
          ? 'Se leyó la etiqueta, pero no contiene una ficha PetCare compartida.'
          : 'Se detectó una etiqueta NFC sin datos de texto.';
        return;
      }

      this.nfcSharedPet.set(profile);
      await this.petStore.sync();
      const localPet = this.petStore.pets().find((pet) => pet.id === profile.id && pet.name === profile.name);
      this.nfcMatchedPet.set(localPet);
      this.mensaje = localPet
        ? `Ficha NFC de ${profile.name} reconocida.`
        : `Se leyó la ficha compartida de ${profile.name}.`;
    } catch (error) {
      this.mensaje = error instanceof Error ? error.message : 'No se pudo leer la etiqueta NFC.';
    }
  }

  async compartirFichaNfc(): Promise<void> {
    const pet = this.mascotaSeleccionada();
    if (!pet) {
      this.mensaje = 'Primero registra una mascota para compartir su ficha.';
      return;
    }
    const profile = {
      type: 'petcare-pet',
      version: 1,
      pet: { id: pet.id, name: pet.name, species: pet.species, breed: pet.breed },
    };
    try {
      await this.deviceLink.writeNfcText(JSON.stringify(profile));
      this.mensaje = `Ficha de ${pet.name} escrita en la etiqueta NFC.`;
    } catch (error) {
      this.mensaje = error instanceof Error ? error.message : 'No se pudo compartir la ficha por NFC.';
    }
  }

  abrirMascotaLeidaNfc(): void {
    this.seleccionarMascota(this.nfcMatchedPet());
  }

  private parseNfcPetProfile(text: string): { id: string; name: string; species: string; breed: string } | null {
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object') return null;
      const payload = value as {
        type?: unknown;
        version?: unknown;
        pet?: { id?: unknown; name?: unknown; species?: unknown; breed?: unknown };
      };
      if (
        payload.type !== 'petcare-pet' || payload.version !== 1 || !payload.pet ||
        typeof payload.pet.id !== 'string' || typeof payload.pet.name !== 'string' ||
        typeof payload.pet.species !== 'string'
      ) return null;
      return {
        id: payload.pet.id,
        name: payload.pet.name,
        species: payload.pet.species,
        breed: typeof payload.pet.breed === 'string' ? payload.pet.breed : '',
      };
    } catch {
      return null;
    }
  }

  compartir(): void {
    this.mensaje =
      'Expediente preparado para compartir de forma segura.';
  }

  async registrarAtencionRealizada(): Promise<void> {
    if (this.guardando()) return;
    const pet = this.mascotaHistorialSeleccionada();
    const petName = pet?.name.trim() ?? '';
    const owner = this.auth.currentUser()?.trim() ?? '';
    const originalDescription = this.cuidadoRealizado;
    const description = originalDescription.trim();
    if (!pet || !owner || !description) {
      this.mensaje = 'Selecciona una mascota y describe la atención que ya ocurrió.';
      return;
    }

    this.guardando.set(true);
    try {
      await this.careRecords.save({
        petName,
        petId: pet.id,
        owner,
        category: this.historyCategory,
        description,
      });
      if (this.cuidadoRealizado === originalDescription) {
        this.cuidadoRealizado = '';
      }
      void this.careRecords.loadRecords();
    } catch {
      this.mensaje = 'No se pudo guardar la atención en este dispositivo. Conserva el texto e inténtalo de nuevo.';
    } finally {
      this.guardando.set(false);
    }
  }

  async agregarVideoHistorial(): Promise<void> {
    if (this.savingVideo()) return;
    const pet = this.mascotaHistorialSeleccionada();
    const owner = this.auth.currentUser()?.trim() ?? '';
    if (!pet || !owner) {
      this.videoMessage.set('Selecciona una mascota antes de agregar un video.');
      return;
    }

    this.videoMessage.set('');
    this.savingVideo.set(true);
    try {
      const { results } = await Camera.chooseFromGallery({
        mediaType: MediaTypeSelection.Video,
        includeMetadata: true,
      });
      const selectedVideo = results.find((item) => item.type === MediaType.Video);
      if (!selectedVideo) return;
      if (selectedVideo.metadata?.size && selectedVideo.metadata.size > PetMediaService.maxSizeBytes) {
        throw new Error('El video debe pesar menos de 35 MB.');
      }
      if (selectedVideo.metadata?.duration && selectedVideo.metadata.duration > PetMediaService.maxDurationSeconds) {
        throw new Error('El video debe durar 60 segundos o menos.');
      }
      if (!selectedVideo.webPath) throw new Error('No se pudo acceder al archivo seleccionado.');

      const response = await fetch(selectedVideo.webPath);
      if (!response.ok) throw new Error('No se pudo leer el video de la galería.');
      const length = Number(response.headers.get('content-length'));
      if (length > PetMediaService.maxSizeBytes) throw new Error('El video debe pesar menos de 35 MB.');
      const blob = await response.blob();
      const duration = selectedVideo.metadata?.duration || await this.duracionVideo(blob);
      if (this.auth.currentUser()?.trim() !== owner || this.mascotaHistorialSeleccionada()?.id !== pet.id) {
        throw new Error('Cambió la mascota o la sesión. Selecciónala de nuevo e inténtalo.');
      }
      await this.petMedia.addVideo({
        owner,
        petId: pet.id,
        petName: pet.name,
        caption: this.videoCaption,
        blob,
        durationSeconds: duration,
        poster: selectedVideo.thumbnail ? `data:image/jpeg;base64,${selectedVideo.thumbnail}` : '',
      });
      this.videoCaption = '';
      this.videoMessage.set(`Video agregado al historial de ${pet.name}. Se guarda en este dispositivo.`);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === CameraErrorCode.ChooseMediaCancelled || (error instanceof Error && /cancel|canceled|cancelled/i.test(error.message))) return;
      this.videoMessage.set(error instanceof Error ? error.message : 'No se pudo agregar el video. Inténtalo de nuevo.');
    } finally {
      this.savingVideo.set(false);
    }
  }

  async eliminarVideoHistorial(clip: PetVideoClip): Promise<void> {
    if (!window.confirm(`¿Eliminar este video del historial de ${clip.petName}?`)) return;
    try {
      await this.petMedia.deleteVideo(clip.id);
      this.videoMessage.set('Video eliminado del historial.');
    } catch {
      this.videoMessage.set('No se pudo eliminar el video. Inténtalo de nuevo.');
    }
  }

  abrirReproductorVideo(clip: PetVideoClip): void {
    this.selectedVideoId.set(clip.id);
    this.videoPositions.update((positions) => ({ ...positions, [clip.id]: 0 }));
  }

  abrirAlbumVideos(): void {
    this.selectedVideoId.set('');
    this.videoAlbumOpen.set(true);
  }

  volverAlbumVideos(player: HTMLVideoElement): void {
    player.pause();
    this.playingVideoId.set('');
    this.selectedVideoId.set('');
  }

  cerrarAlbumVideos(): void {
    this.petVideoPlayers?.forEach((reference) => reference.nativeElement.pause());
    this.playingVideoId.set('');
    this.selectedVideoId.set('');
    this.videoAlbumOpen.set(false);
  }

  async alternarReproduccionVideo(id: string, player: HTMLVideoElement): Promise<void> {
    if (!player.paused && this.playingVideoId() === id) {
      player.pause();
      this.playingVideoId.set('');
      return;
    }
    this.petVideoPlayers?.forEach((reference) => {
      if (reference.nativeElement !== player) reference.nativeElement.pause();
    });
    this.playingVideoId.set(id);
    try {
      await player.play();
    } catch {
      this.playingVideoId.set('');
      this.videoMessage.set('El dispositivo no pudo reproducir este formato de video.');
    }
  }

  actualizarPosicionVideo(id: string, player: HTMLVideoElement): void {
    this.videoPositions.update((positions) => ({ ...positions, [id]: player.currentTime }));
    if (player.paused) this.videoPausado(id);
  }

  videoPausado(id: string): void {
    if (this.playingVideoId() === id) this.playingVideoId.set('');
  }

  buscarVideo(player: HTMLVideoElement, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) player.currentTime = value;
  }

  ajustarVolumenVideo(player: HTMLVideoElement, event: Event): void {
    player.volume = Number((event.target as HTMLInputElement).value);
    player.muted = false;
  }

  alternarSilencioVideo(player: HTMLVideoElement): void {
    player.muted = !player.muted;
  }

  cambiarVelocidadVideo(player: HTMLVideoElement): void {
    const speeds = [1, 1.25, 1.5, 2];
    const index = speeds.indexOf(player.playbackRate);
    player.playbackRate = speeds[(index + 1) % speeds.length];
  }

  expandirVideo(player: HTMLVideoElement): void {
    const surface = player.parentElement;
    if (!surface) return;
    if (document.fullscreenElement === surface) {
      void document.exitFullscreen();
    } else if (surface.requestFullscreen) {
      void surface.requestFullscreen().catch(() => this.videoMessage.set('La pantalla completa no está disponible en este dispositivo.'));
    }
  }

  formatearTiempoVideo(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const wholeSeconds = Math.floor(seconds);
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
  }

  posicionVideo(id: string): number {
    return this.videoPositions()[id] || 0;
  }

  private async duracionVideo(blob: Blob): Promise<number> {
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise<number>((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => resolve(video.duration);
        video.onerror = () => reject(new Error('No se pudo leer la duración del video.'));
        video.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async guardarPlanCuidado(): Promise<void> {
    if (this.savingCarePlan()) return;
    this.carePlanMessage.set('');
    const selectedPet = this.petStore.pets().find((pet) => pet.id === this.carePlanPetId);
    if (!selectedPet) {
      this.carePlanMessage.set('Registra o selecciona una mascota para continuar.');
      return;
    }

    const title = this.carePlanTitle.trim() || (this.carePlanType === 'Control de salud' ? 'Control de salud' : '');
    const weightKg = typeof this.carePlanWeight === 'number' ? this.carePlanWeight : null;
    const temperatureC = typeof this.carePlanTemperature === 'number' ? this.carePlanTemperature : null;
    const dueAt = new Date(this.carePlanDueAt);
    if (!Number.isFinite(dueAt.getTime())) {
      this.carePlanMessage.set('Indica una fecha válida para este cuidado.');
      return;
    }
    const draft: CarePlanDraft = {
      petId: selectedPet.id,
      type: this.carePlanType,
      title,
      details: this.carePlanDetails,
      dueAt: dueAt.toISOString(),
      weightKg,
      temperatureC,
    };

    this.savingCarePlan.set(true);
    try {
      await this.carePlan.add(draft);
      this.carePlanTitle = '';
      this.carePlanDetails = '';
      this.carePlanWeight = null;
      this.carePlanTemperature = null;
      this.carePlanDueAt = this.fechaLocalInput(this.carePlanType === 'Control de salud' ? 0 : 24 * 60 * 60 * 1000);
      this.carePlanMessage.set(
        this.carePlanType === 'Control de salud'
          ? `Control de ${selectedPet.name} guardado en su historial.`
          : `Recordatorio de ${selectedPet.name} guardado.`,
      );
    } catch (error) {
      this.carePlanMessage.set(error instanceof Error ? error.message : 'No se pudo guardar este cuidado. Inténtalo de nuevo.');
    } finally {
      this.savingCarePlan.set(false);
    }
  }

  async completarPlanCuidado(entry: CarePlanEntry): Promise<void> {
    try {
      await this.carePlan.setCompleted(entry.id, entry.status !== 'completed');
      this.carePlanMessage.set(entry.status === 'completed' ? 'Recordatorio reactivado.' : 'Cuidado marcado como realizado.');
    } catch (error) {
      this.carePlanMessage.set(error instanceof Error ? error.message : 'No se pudo actualizar este recordatorio.');
    }
  }

  async eliminarPlanCuidado(entry: CarePlanEntry): Promise<void> {
    if (!window.confirm(`¿Eliminar “${entry.title}” de ${entry.petName}?`)) return;
    try {
      await this.carePlan.remove(entry.id);
      this.carePlanMessage.set('Registro eliminado.');
    } catch (error) {
      this.carePlanMessage.set(error instanceof Error ? error.message : 'No se pudo eliminar este registro.');
    }
  }

  actualizarTipoCuidado(type: CarePlanType): void {
    this.carePlanType = type;
    this.carePlanTitle = type === 'Control de salud' ? 'Control de salud' : '';
    if (type === 'Control de salud') this.carePlanDueAt = this.fechaLocalInput(0);
  }

  recordatorioLabel(entry: CarePlanEntry): string {
    if (entry.status === 'completed') return 'Realizado';
    const days = Math.floor((this.inicioDelDia(Date.parse(entry.dueAt)) - this.inicioDelDia(Date.now())) / 86_400_000);
    if (days < 0) return 'Vencido';
    if (days === 0) return 'Hoy';
    if (days === 1) return 'Mañana';
    if (days <= 3) return `En ${days} días`;
    return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.dueAt));
  }

  ultimoControl(petId: string): CarePlanEntry | undefined {
    return this.carePlan.latestMeasurement(petId);
  }

  planesPendientesMascota(petId: string): CarePlanEntry[] {
    return this.carePlan.pendingEntries().filter((entry) => entry.petId === petId).slice(0, 3);
  }

  private inicioDelDia(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  private fechaLocalInput(offsetMs: number): string {
    const date = new Date(Date.now() + offsetMs);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  }

  private prepararFormularioCuidados(): void {
    const pets = this.petStore.pets();
    if (!pets.some((pet) => pet.id === this.carePlanPetId)) {
      this.carePlanPetId = this.mascotaSeleccionada()?.id ?? pets[0]?.id ?? '';
    }
  }

  private prepararMascotaHistorial(): void {
    const pets = this.petStore.pets();
    if (pets.some((pet) => pet.id === this.historialMascotaId())) {
      this.nombreMascota = this.mascotaHistorialSeleccionada()?.name ?? this.nombreMascota;
      this.cargarVideosHistorial(this.historialMascotaId());
      return;
    }
    const selected = this.mascotaSeleccionada() ?? pets[0];
    this.historialMascotaId.set(selected?.id ?? '');
    this.nombreMascota = selected?.name ?? '';
    if (selected) this.cargarVideosHistorial(selected.id);
  }

  seleccionarMascotaHistorial(petId: string): void {
    this.historialMascotaId.set(petId);
    this.nombreMascota = this.petStore.pets().find((pet) => pet.id === petId)?.name ?? '';
    this.videoMessage.set('');
    this.cargarVideosHistorial(petId);
  }

  private cargarVideosHistorial(petId: string): void {
    const owner = this.auth.currentUser()?.trim() ?? '';
    void this.petMedia.loadForPet(owner, petId).catch(() => {
      this.videoMessage.set('No se pudieron cargar los videos guardados en este dispositivo.');
    });
  }

  async sincronizarPendientes(): Promise<void> {
    if (!this.enLinea) {
      this.mensaje = 'No hay conexión. Los datos continúan guardados en este dispositivo.';
      return;
    }
    if (!this.pendientes.length) {
      this.mensaje = 'No existen registros pendientes de sincronización.';
      return;
    }
    await this.careRecords.syncPending();
  }

  private actualizarEstadoRed(status: ConnectionStatus): void {
    this.connectivity.updateNetworkStatus(status.connected);
  }

  async alternarMascotaPerdida(): Promise<void> {
    const pet = this.mascotaSeleccionada();
    const username = this.auth.currentUser()?.trim();
    if (!pet || !username) return;

    const nextState = !this.mascotaPerdida;
    this.mascotaPerdida = nextState;
    this.lostQrError.set('');
    this.lostPetQr.set('');
    const key = this.claveMascotaPerdida(username, pet.id);
    const states = this.leerMascotasPerdidas();
    if (nextState) {
      this.fechaAlertaPerdida = new Date().toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });
      states[key] = { active: true, reportedAt: this.fechaAlertaPerdida };
      localStorage.setItem('petcare.lost-pets', JSON.stringify(states));
      await this.generarQrMascotaPerdida(pet);
      this.mensaje = this.lostQrError() ? 'La alerta está activa, pero no se pudo generar el QR.' : 'Alerta activada y QR de contacto listo.';
    } else {
      this.fechaAlertaPerdida = '';
      delete states[key];
      localStorage.setItem('petcare.lost-pets', JSON.stringify(states));
      this.mensaje = `${pet.name} fue marcada como encontrada. La alerta quedó desactivada.`;
    }
  }

  private cargarEstadoMascotaPerdida(pet: StoredPet): void {
    const username = this.auth.currentUser()?.trim();
    const state = username ? this.leerMascotasPerdidas()[this.claveMascotaPerdida(username, pet.id)] : undefined;
    this.mascotaPerdida = state?.active ?? false;
    this.fechaAlertaPerdida = state?.reportedAt ?? '';
    this.lostPetQr.set('');
    this.lostQrError.set('');
    if (this.mascotaPerdida) void this.generarQrMascotaPerdida(pet);
  }

  private claveMascotaPerdida(username: string, petId: string): string {
    return `${encodeURIComponent(username)}:${petId}`;
  }

  private leerMascotasPerdidas(): Record<string, { active: boolean; reportedAt: string }> {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('petcare.lost-pets') ?? '{}');
      return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, { active: boolean; reportedAt: string }>
        : {};
    } catch {
      return {};
    }
  }

  private async generarQrMascotaPerdida(pet: StoredPet): Promise<void> {
    this.lostQrLoading.set(true);
    this.lostQrError.set('');
    try {
      const username = this.auth.currentUser()?.trim();
      const contact = username ? await this.database.getUserContact(username) : null;
      if (!contact?.phone) throw new Error('La cuenta no tiene un teléfono de contacto disponible.');
      const details = [
        'PETCARE — MASCOTA PERDIDA',
        `Nombre: ${pet.name}`,
        `Especie: ${pet.species}`,
        pet.breed ? `Raza: ${pet.breed}` : '',
        `Contacto: ${contact.phone}`,
        'Si me encontraste, comunícate con mi familia.',
      ].filter(Boolean).join('\n');
      const image = await QRCode.toDataURL(details, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
        color: { dark: '#123b31', light: '#ffffff' },
      });
      this.lostPetQr.set(image);
    } catch (error) {
      this.lostQrError.set(error instanceof Error ? error.message : 'No se pudo generar el QR.');
    } finally {
      this.lostQrLoading.set(false);
    }
  }

  revisarAlerta(id: number): void {
    this.alertas =
      this.alertas.map(
        (alerta) =>
          alerta.id === id
            ? {
                ...alerta,
                revisada: true
              }
            : alerta
      );

    this.mensaje =
      `Alerta marcada como revisada y añadida al historial de ${this.nombreMascota || 'la mascota'}.`;

    this.guardarEstadoLocal();
  }

  crearAlertaPrueba(): void {
    const nueva: AlertaCollar = {
      id: Date.now(),
      tipo: 'advertencia',
      titulo: 'Collar desconectado',
      detalle:
        'No se recibe señal del collar PetCare PC-01.',
      hora: 'Ahora',
      revisada: false
    };

    this.alertas = [
      nueva,
      ...this.alertas
    ];

    this.mensaje =
      'Alerta de demostración generada.';

    this.guardarEstadoLocal();
  }

  get alertasPendientes(): number {
    return this.alertas.filter(
      (alerta) => !alerta.revisada
    ).length;
  }

  private agregarAlertaDesconexion(): void {
    const alertaPendiente =
      this.alertas.some(
        (alerta) =>
          alerta.titulo ===
            'Collar desconectado' &&
          !alerta.revisada
      );

    if (alertaPendiente) {
      return;
    }

    this.crearAlertaPrueba();
  }

  private cargarEstadoLocal(): void {
    try {
      localStorage.removeItem('petcare-mascota-perdida');
      localStorage.removeItem('petcare-fecha-perdida');
      localStorage.removeItem('petcare-hallazgo');

      const alertasGuardadas =
        localStorage.getItem(
          'petcare-alertas'
        );

      if (alertasGuardadas) {
        this.alertas =
          JSON.parse(alertasGuardadas);
      }
    } catch {
      // Si el almacenamiento local está dañado,
      // se mantienen los valores iniciales.
    }
  }

  private guardarEstadoLocal(): void {
    localStorage.setItem(
      'petcare-alertas',
      JSON.stringify(this.alertas)
    );
  }
}
