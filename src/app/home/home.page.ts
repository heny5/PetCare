import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Network,
  ConnectionStatus
} from '@capacitor/network';
import type {
  PluginListenerHandle
} from '@capacitor/core';
import { IonContent } from '@ionic/angular';

type Vista =
  | 'inicio'
  | 'mascotas'
  | 'detalle'
  | 'conectar'
  | 'sensor'
  | 'nfc'
  | 'historial'
  | 'alertas'
  | 'compartir';

interface RegistroPendiente {
  id: string;
  tipo: string;
  detalle: string;
  fecha: string;
}

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
    RouterLink
  ],
})
export class HomePage implements OnInit, OnDestroy {
  vista: Vista = 'inicio';

  dispositivoConectado = false;
  lecturaNfc = false;
  mensaje = '';
  enLinea = true;
  sincronizando = false;
  ultimaSincronizacion = '';

  pendientes: RegistroPendiente[] = [];

  modoDemostracion = true;
  estadoRealConexion = true;

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

  async ngOnInit(): Promise<void> {
    this.cargarPendientes();
    this.cargarEstadoLocal();

    const estado =
      await Network.getStatus();

    this.actualizarEstadoRed(estado);

    this.networkListener =
      await Network.addListener(
        'networkStatusChange',
        (status) => {
          this.actualizarEstadoRed(status);
        }
      );
  }

  async ngOnDestroy(): Promise<void> {
    await this.networkListener?.remove();
  }

  abrir(vista: Vista): void {
    this.vista = vista;
    this.mensaje = '';
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
    const detalle =
      this.cuidadoRealizado.trim() ||
      'Control de hidratación y actividad normal.';

    const registro: RegistroPendiente = {
      id: `PET-${Date.now()}`,
      tipo:
        `Cuidado de ${
          this.nombreMascota.trim() || 'Luna'
        }`,
      detalle,
      fecha: new Date().toISOString()
    };

    this.pendientes.push(registro);
    this.guardarPendientes();

    this.cuidadoRealizado = '';

    this.mensaje = this.enLinea
      ? 'Registro creado. Iniciando sincronización…'
      : 'Registro guardado en el dispositivo. Se sincronizará cuando regrese internet.';

    if (this.enLinea) {
      await this.sincronizarPendientes();
    }
  }

  async sincronizarPendientes(): Promise<void> {
    if (!this.enLinea) {
      this.mensaje =
        'No hay conexión. Los datos continúan guardados en este dispositivo.';

      return;
    }

    if (this.sincronizando) {
      return;
    }

    if (this.pendientes.length === 0) {
      this.mensaje =
        'No existen registros pendientes de sincronización.';

      return;
    }

    this.sincronizando = true;

    for (const registro of [
      ...this.pendientes
    ]) {
      try {
        const respuesta =
          await fetch(
            'https://jsonplaceholder.typicode.com/posts',
            {
              method: 'POST',
              headers: {
                'Content-Type':
                  'application/json'
              },
              body: JSON.stringify({
                ...registro,
                mascota: 'Luna',
                aplicacion: 'PetCare'
              })
            }
          );

        if (!respuesta.ok) {
          throw new Error(
            'Servidor sin respuesta'
          );
        }

        this.pendientes =
          this.pendientes.filter(
            (item) =>
              item.id !== registro.id
          );

        this.guardarPendientes();
      } catch {
        this.mensaje =
          'No fue posible contactar el servidor de demostración. El registro sigue pendiente.';

        break;
      }
    }

    this.sincronizando = false;

    if (this.pendientes.length === 0) {
      this.ultimaSincronizacion =
        new Date().toLocaleTimeString(
          'es-DO',
          {
            hour: '2-digit',
            minute: '2-digit'
          }
        );

      this.mensaje =
        'Sincronización completada correctamente.';
    }
  }

  private actualizarEstadoRed(
    status: ConnectionStatus
  ): void {
    this.estadoRealConexion =
      status.connected;

    if (this.modoDemostracion) {
      return;
    }

    const estabaSinConexion =
      !this.enLinea;

    this.enLinea =
      status.connected;

    if (
      this.enLinea &&
      (
        estabaSinConexion ||
        this.pendientes.length > 0
      )
    ) {
      void this.sincronizarPendientes();
    }
  }

  private cargarPendientes(): void {
    try {
      this.pendientes =
        JSON.parse(
          localStorage.getItem(
            'petcare-pendientes'
          ) ?? '[]'
        );
    } catch {
      this.pendientes = [];
    }
  }

  private guardarPendientes(): void {
    localStorage.setItem(
      'petcare-pendientes',
      JSON.stringify(this.pendientes)
    );
  }

  cambiarConexionDemo(
    conectado: boolean
  ): void {
    const estabaSinConexion =
      !this.enLinea;

    this.modoDemostracion = true;
    this.enLinea = conectado;

    this.mensaje = conectado
      ? 'Modo demostración: conexión recuperada.'
      : 'Modo demostración: ahora estás sin conexión.';

    localStorage.setItem(
      'petcare-demo-online',
      JSON.stringify(conectado)
    );

    if (
      conectado &&
      (
        estabaSinConexion ||
        this.pendientes.length > 0
      )
    ) {
      void this.sincronizarPendientes();
    }
  }

  usarEstadoReal(): void {
    this.modoDemostracion = false;

    this.enLinea =
      this.estadoRealConexion;

    this.mensaje =
      'PetCare volvió a utilizar el estado real de la red.';
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
      const demo =
        localStorage.getItem(
          'petcare-demo-online'
        );

      if (demo !== null) {
        this.enLinea =
          JSON.parse(demo);
      }

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
