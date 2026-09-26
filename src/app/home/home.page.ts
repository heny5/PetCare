import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
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
import { IonContent, IonIcon, IonPopover } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { personCircleOutline } from 'ionicons/icons';
import { PetService } from '../services/pet.service';
import { PET_SPECIES, PET_SEXES, PetDraft, StoredPet, isPetDraft } from '../services/pet.model';
import { CareRecordService } from '../services/care-record.service';
import { ConnectivityService } from '../services/connectivity.service';
import { AuthService } from '../services/auth.service';

type Vista =
  | 'inicio'
  | 'mascotas'
  | 'nueva-mascota'
  | 'detalle'
  | 'conectar'
  | 'sensor'
  | 'nfc'
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
    RouterLink
  ],
})
export class HomePage implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  vista: Vista = 'inicio';

  dispositivoConectado = false;
  lecturaNfc = false;
  readonly careRecords = inject(CareRecordService);
  readonly petStore = inject(PetService);
  readonly totalPendientes = computed(() => this.careRecords.pendingCount() + this.petStore.pendingCount());
  readonly especies = PET_SPECIES;
  readonly sexos = PET_SEXES;
  readonly errorMascota = signal('');
  readonly avisoMascota = signal('');
  private readonly mascotaId = signal('demo-luna');
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
  get modoDemostracion(): boolean { return this.connectivity.isDemoMode(); }
  get sincronizando(): boolean { return this.careRecords.isSynchronizing(); }
  get pendientes() { return this.registrosPendientes(); }
  get ultimaSincronizacion(): string {
    const fecha = this.careRecords.lastSyncedAt();
    return fecha ? new Date(fecha).toLocaleTimeString('es-DO', {
      hour: '2-digit', minute: '2-digit',
    }) : '';
  }

  buscandoBluetooth = false;
  dispositivoEncontrado = false;

  mascotaPerdida = false;
  fechaAlertaPerdida = '';
  hallazgoRegistrado = false;

  nombreMascota = 'Luna';
  cuidadoRealizado = '';

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
        'Luna permaneció inactiva más tiempo de lo habitual.',
      hora: 'Ayer · 9:10 p. m.',
      revisada: true
    }
  ];

  private networkListener?: PluginListenerHandle;
  private destroyed = false;

  constructor() {
    addIcons({ personCircleOutline });
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
    this.auth.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }


  abrir(vista: Vista): void {
    this.mascotaPorEliminar = null;
    this.vista = vista;
    this.mensaje = '';
    if (vista === 'mascotas') this.petStore.activate();
  }

  abrirFormularioMascota(): void {
    this.editandoMascotaId = null;
    this.nuevaMascota = this.formularioMascotaVacio();
    this.errorMascota.set('');
    this.avisoMascota.set('');
    this.abrir('nueva-mascota');
  }

  registrarMascota(form: NgForm): void {
    if (this.vista !== 'nueva-mascota') return;
    this.errorMascota.set('');
    if (form.invalid || !isPetDraft(this.nuevaMascota)) {
      this.errorMascota.set('Completa los campos obligatorios y revisa la edad y el peso.');
      return;
    }
    try {
      const pet = this.editandoMascotaId
        ? this.petStore.update(this.editandoMascotaId, this.nuevaMascota)
        : this.petStore.add(this.nuevaMascota);
      this.avisoMascota.set(this.editandoMascotaId ? `Se actualizaron los datos de ${pet.name}.` : `${pet.name} se añadió a tus mascotas.`);
      this.abrir('mascotas');
    } catch {
      this.errorMascota.set('No se pudo guardar la mascota en este dispositivo. Conserva los datos e inténtalo de nuevo.');
    }
  }

  seleccionarMascota(pet: StoredPet | undefined): void {
    if (!pet) { this.abrir('mascotas'); return; }
    this.mascotaId.set(pet.id);
    this.nombreMascota = pet.name;
    this.abrir('detalle');
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

  eliminarMascota(): void {
    const pet = this.mascotaPorEliminar;
    if (!pet) return;
    try {
      this.petStore.remove(pet.id);
      this.avisoMascota.set(`${pet.name} se eliminó de tus mascotas.`);
      this.abrir('mascotas');
    } catch {
      this.errorMascota.set('No se pudo eliminar la mascota. Inténtalo de nuevo.');
    }
  }

  abrirCuidadosMascota(): void {
    const pet = this.mascotaSeleccionada();
    if (!pet) { this.abrir('mascotas'); return; }
    this.nombreMascota = pet.name;
    this.abrir('historial');
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

  conectar(): void {
    this.dispositivoConectado = true;

    this.mensaje =
      'Collar PetCare vinculado correctamente.';
  }

  buscarDispositivos(): void {
    this.buscandoBluetooth = true;
    this.dispositivoEncontrado = false;

    this.mensaje =
      'Buscando dispositivos Bluetooth LE cercanos…';

    setTimeout(() => {
      this.buscandoBluetooth = false;
      this.dispositivoEncontrado = true;

      this.mensaje =
        'Se encontró 1 dispositivo compatible.';
    }, 1200);
  }

  desconectar(): void {
    this.dispositivoConectado = false;

    this.mensaje =
      'Collar PetCare desconectado.';

    this.agregarAlertaDesconexion();
  }

  simularNfc(): void {
    this.lecturaNfc = true;

    this.mensaje =
      'Etiqueta detectada: PET-LUNA-001';
  }

  compartir(): void {
    this.mensaje =
      'Expediente preparado para compartir de forma segura.';
  }

  async registrarControl(): Promise<void> {
    if (this.guardando()) return;
    const petName = this.nombreMascota.trim();
    const originalDescription = this.cuidadoRealizado;
    const description = originalDescription.trim();
    if (!petName || !description) {
      this.mensaje = 'Completa el nombre de la mascota y el cuidado realizado.';
      return;
    }

    this.guardando.set(true);
    try {
      await this.careRecords.save({ petName, description });
      if (this.cuidadoRealizado === originalDescription) {
        this.cuidadoRealizado = '';
      }
    } catch {
      this.mensaje = 'No se pudo guardar el cuidado en este dispositivo. Conserva el texto e inténtalo de nuevo.';
    } finally {
      this.guardando.set(false);
    }
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

  cambiarConexionDemo(conectado: boolean): void {
    this.connectivity.setDemoOnline(conectado);
    this.mensaje = conectado
      ? 'Modo demostración: conexión recuperada.'
      : 'Modo demostración: ahora estás sin conexión.';
    if (conectado) void this.careRecords.syncPending();
  }

  usarEstadoReal(): void {
    this.connectivity.useRealNetwork();
    this.mensaje = 'PetCare volvió a utilizar el estado real de la red.';
    if (this.enLinea) void this.careRecords.syncPending();
  }

  alternarMascotaPerdida(): void {
    this.mascotaPerdida =
      !this.mascotaPerdida;

    this.hallazgoRegistrado = false;

    this.fechaAlertaPerdida =
      this.mascotaPerdida
        ? new Date().toLocaleString(
            'es-DO',
            {
              dateStyle: 'medium',
              timeStyle: 'short'
            }
          )
        : '';

    this.mensaje =
      this.mascotaPerdida
        ? 'Alerta activada. La lectura NFC mostrará la ficha de mascota perdida.'
        : 'Luna fue marcada como encontrada. La alerta quedó desactivada.';

    this.guardarEstadoLocal();
  }

  registrarHallazgo(): void {
    this.hallazgoRegistrado = true;

    this.mensaje =
      'Hallazgo registrado en Santiago, República Dominicana.';

    this.guardarEstadoLocal();
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
      'Alerta marcada como revisada y añadida al historial de Luna.';

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
      this.mascotaPerdida =
        JSON.parse(
          localStorage.getItem(
            'petcare-mascota-perdida'
          ) ?? 'false'
        );

      this.fechaAlertaPerdida =
        localStorage.getItem(
          'petcare-fecha-perdida'
        ) ?? '';

      this.hallazgoRegistrado =
        JSON.parse(
          localStorage.getItem(
            'petcare-hallazgo'
          ) ?? 'false'
        );

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
      'petcare-mascota-perdida',
      JSON.stringify(
        this.mascotaPerdida
      )
    );

    localStorage.setItem(
      'petcare-fecha-perdida',
      this.fechaAlertaPerdida
    );

    localStorage.setItem(
      'petcare-hallazgo',
      JSON.stringify(
        this.hallazgoRegistrado
      )
    );

    localStorage.setItem(
      'petcare-alertas',
      JSON.stringify(this.alertas)
    );
  }
}
