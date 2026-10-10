import { Component, NgZone, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonChip,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonRange,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar
} from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { Geolocation, Position } from '@capacitor/geolocation';
import { Share } from '@capacitor/share';
import * as L from 'leaflet';
import {
  LocationSearchResult,
  NearbyPlace,
  PlaceCategory,
  PlacesService
} from '../services/places';

/** Pantalla de ubicación, seguimiento, búsqueda de lugares y mapa interactivo. */
@Component({
  selector: 'app-location',
  templateUrl: './location.page.html',
  styleUrls: ['./location.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonBackButton,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonChip,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonList,
    IonNote,
    IonRange,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
    IonSpinner,
    IonTitle,
    IonToolbar
  ]
})
export class LocationPage implements OnDestroy {
  // Última lectura disponible: coordenadas en grados, precisión en metros y hora local.
  latitude: number | null = null;
  longitude: number | null = null;
  accuracy: number | null = null;
  lastUpdate = '';

  // Estados independientes para obtener ubicación, seguirla y consultar lugares.
  loading = false;
  tracking = false;
  loadingPlaces = false;
  searching = false;

  statusMessage =
    'Presiona “Obtener ubicación” para activar el GPS.';
  errorMessage = '';

  searchText = '';
  searchResults: LocationSearchResult[] = [];

  // Filtros usados al consultar establecimientos alrededor de la ubicación actual.
  selectedCategory: PlaceCategory = 'petStores';
  searchRadiusKm = 3;
  nearbyPlaces: NearbyPlace[] = [];

  // Referencias de Leaflet y del seguimiento GPS para actualizar y liberar recursos.
  private map?: L.Map;
  private userMarker?: L.CircleMarker;
  private searchMarker?: L.CircleMarker;
  private accuracyCircle?: L.Circle;
  private placesLayer?: L.LayerGroup;
  private watchId: string | null = null;

  // Relaciona cada lugar con su marcador para abrirlo al seleccionar una fila.
  private placeMarkers =
    new Map<string, L.CircleMarker>();

  constructor(
    private ngZone: NgZone,
    private placesService: PlacesService
  ) {}

  /** Ajusta precisión, espera y antigüedad de la lectura según la plataforma. */
  private getPositionOptions() {
    const isNative = Capacitor.isNativePlatform();

    return {
      enableHighAccuracy: isNative,
      timeout: isNative ? 30000 : 12000,
      maximumAge: isNative ? 0 : 60000
    };
  }

  /** Limita la espera de una promesa; no cancela la solicitud de ubicación subyacente. */
  private withHardTimeout<T>(
    request: Promise<T>,
    milliseconds: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(
          new Error(
            'La ubicación no respondió dentro del tiempo permitido.'
          )
        );
      }, milliseconds);

      request.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          window.clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  /** Recupera una lectura guardada con coordenadas válidas y antigüedad máxima de un día. */
  private restoreLastPosition(): boolean {
    try {
      const saved = localStorage.getItem(
        'petcare-last-location'
      );

      if (!saved) {
        return false;
      }

      const data = JSON.parse(saved) as {
        latitude: number;
        longitude: number;
        accuracy: number;
        timestamp: number;
      };

      if (
        !Number.isFinite(data.latitude) ||
        !Number.isFinite(data.longitude) ||
        !Number.isFinite(data.accuracy) ||
        Date.now() - data.timestamp > 86400000
      ) {
        return false;
      }

      // Adapta los datos guardados al formato Position que utiliza updatePosition.
      const cachedPosition = {
        timestamp: data.timestamp,
        coords: {
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: data.accuracy,
          altitudeAccuracy: null,
          altitude: null,
          speed: null,
          heading: null,
          magneticHeading: null,
          trueHeading: null,
          headingAccuracy: null,
          course: null
        }
      } as Position;

      this.updatePosition(cachedPosition, true);
      return true;
    } catch {
      return false;
    }
  }

  /** Solicita en segundo plano una lectura web más precisa y la aplica si mejora la actual. */
  private async refineWebPosition(): Promise<void> {
    try {
      const refinedPosition =
        await this.withHardTimeout(
          Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
          }),
          15000
        );

      if (
        this.accuracy === null ||
        refinedPosition.coords.accuracy < this.accuracy
      ) {
        this.updatePosition(refinedPosition, true);

        this.statusMessage =
          `Ubicación mejorada. Precisión aproximada: ${Math.round(refinedPosition.coords.accuracy)} metros.`;
      }
    } catch {
      // La mejora es opcional y silenciosa. La ubicación inicial ya es válida.
    }
  }

  // Espera a que la vista esté visible antes de crear o redimensionar el mapa.
  ionViewDidEnter(): void {
    setTimeout(() => this.initializeMap(), 150);
  }

  /** Crea el mapa sobre República Dominicana y una capa separada para lugares cercanos. */
  private initializeMap(): void {
    if (this.map) {
      // Recalcula el tamaño cuando se vuelve a una vista con un mapa ya creado.
      this.map.invalidateSize();
      return;
    }

    this.map = L.map('location-map').setView(
      [18.7357, -70.1627],
      8
    );

    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; colaboradores de OpenStreetMap'
      }
    ).addTo(this.map);

    this.placesLayer =
      L.layerGroup().addTo(this.map);
  }

  /** En la app nativa, comprueba y solicita permiso de ubicación antes de usar el GPS. */
  private async verifyPermission(): Promise<void> {
    // En web, el permiso se gestiona al solicitar la ubicación al navegador.
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const permission =
      await Geolocation.checkPermissions();

    if (permission.location === 'granted') {
      return;
    }

    const requested =
      await Geolocation.requestPermissions({
        permissions: ['location']
      });

    if (requested.location !== 'granted') {
      throw new Error(
        'Debes permitir la ubicación precisa para utilizar el GPS.'
      );
    }
  }

  /** Muestra la lectura guardada mientras solicita una ubicación actualizada. */
  async getCurrentLocation(): Promise<void> {
    const restoredPosition =
      this.restoreLastPosition();

    this.loading = !restoredPosition;
    this.errorMessage = '';
    this.statusMessage = restoredPosition
      ? 'Mostrando la última ubicación mientras se actualiza…'
      : 'Buscando señal de ubicación…';

    try {
      await this.verifyPermission();

      const position =
        await this.withHardTimeout(
          Geolocation.getCurrentPosition(
            this.getPositionOptions()
          ),
          Capacitor.isNativePlatform()
            ? 32000
            : 12000
        );

      this.updatePosition(position, true);

      if (Capacitor.isNativePlatform()) {
        this.statusMessage =
          `Ubicación obtenida. Precisión aproximada: ${Math.round(position.coords.accuracy)} metros.`;
      } else {
        this.statusMessage =
          `Ubicación lista. Precisión aproximada: ${Math.round(position.coords.accuracy)} metros.`;

        // Intenta mejorar la lectura en segundo plano, sin mantener la interfaz cargando.
        void this.refineWebPosition();
      }
    // Si falla la actualización, conserva la lectura que se pudo recuperar.
    } catch (error) {
      if (restoredPosition) {
        this.errorMessage =
          'No fue posible actualizar la ubicación. Se mantiene la última lectura guardada.';
        this.statusMessage =
          'Última ubicación disponible.';
      } else {
        this.showError(error);
      }
    } finally {
      this.loading = false;
    }
  }

  /** Alterna el seguimiento continuo y procesa las nuevas lecturas del GPS. */
  async toggleTracking(): Promise<void> {
    if (this.tracking) {
      await this.stopTracking();
      return;
    }

    this.errorMessage = '';

    try {
      await this.verifyPermission();

      this.watchId =
        await Geolocation.watchPosition(
          {
            ...this.getPositionOptions(),
            enableHighAccuracy: true,
            maximumAge: 0,
            minimumUpdateInterval: 3000,
            interval: 5000
          },
          (position, error) => {
            // Lleva el callback del plugin a Angular para actualizar los datos de la vista.
            this.ngZone.run(() => {
              if (error) {
                this.showError(error);
                return;
              }

              if (position) {
                const previousAccuracy = this.accuracy;
                const newAccuracy = position.coords.accuracy;

                // En web, descarta lecturas que empeoran más de 25 metros y duplican el error anterior.
                const isClearlyLessAccurate =
                  !Capacitor.isNativePlatform() &&
                  previousAccuracy !== null &&
                  newAccuracy > previousAccuracy + 25 &&
                  newAccuracy > previousAccuracy * 2;

                if (isClearlyLessAccurate) {
                  this.statusMessage =
                    `Seguimiento activo. Se ignoró una lectura imprecisa de ${Math.round(newAccuracy)} metros.`;
                  return;
                }

                this.updatePosition(position, false);

                this.statusMessage =
                  `Seguimiento activo. Precisión aproximada: ${Math.round(newAccuracy)} metros.`;
              }
            });
          }
        );

      this.tracking = true;

      this.statusMessage =
        'Seguimiento en tiempo real activo.';
    } catch (error) {
      this.showError(error);
    }
  }

  /** Cancela el observador GPS y restablece el estado de seguimiento. */
  async stopTracking(): Promise<void> {
    if (this.watchId) {
      await Geolocation.clearWatch({
        id: this.watchId
      });

      this.watchId = null;
    }

    this.tracking = false;

    this.statusMessage =
      'Seguimiento en tiempo real detenido.';
  }

  /** Prepara un enlace con las coordenadas y abre el diálogo de compartir. */
  async shareLocation(): Promise<void> {
    if (
      this.latitude === null ||
      this.longitude === null
    ) {
      this.errorMessage =
        'Primero debes obtener tu ubicación.';
      return;
    }

    const mapUrl =
      `https://www.openstreetmap.org/` +
      `?mlat=${this.latitude}` +
      `&mlon=${this.longitude}` +
      `#map=18/${this.latitude}/${this.longitude}`;

    try {
      await Share.share({
        title: 'Mi ubicación',
        text:
          'Esta es mi ubicación actual: ' +
          `${this.latitude.toFixed(6)}, ` +
          `${this.longitude.toFixed(6)}`,
        url: mapUrl,
        dialogTitle: 'Compartir ubicación'
      });
    } catch (error) {
      this.showError(error);
    }
  }

  /** Consulta el servicio de búsqueda y controla el indicador de carga y sus errores. */
  async searchLocation(): Promise<void> {
    this.searching = true;
    this.errorMessage = '';
    this.searchResults = [];

    try {
      this.searchResults =
        await this.placesService.searchLocation(
          this.searchText
        );

      if (this.searchResults.length === 0) {
        this.statusMessage =
          'No se encontraron ubicaciones.';
      }
    } catch (error) {
      this.showError(error);
    } finally {
      this.searching = false;
    }
  }

  /** Coloca o mueve el marcador de búsqueda y centra el mapa en el resultado elegido. */
  selectSearchResult(
    result: LocationSearchResult
  ): void {
    const coordinates: L.LatLngExpression = [
      result.latitude,
      result.longitude
    ];

    if (this.searchMarker) {
      this.searchMarker.setLatLng(coordinates);
    } else {
      this.searchMarker =
        L.circleMarker(coordinates, {
          radius: 9,
          color: '#ffffff',
          weight: 3,
          fillColor: '#f97316',
          fillOpacity: 1
        })
          .addTo(this.map!)
          .bindPopup('Ubicación encontrada');
    }

    this.map!.setView(coordinates, 16);
    this.searchMarker.openPopup();
    this.searchResults = [];

    this.statusMessage =
      `Ubicación encontrada: ${result.name}`;
  }

  /** Obtiene una ubicación si hace falta y consulta los lugares de la categoría seleccionada. */
  async findNearbyPlaces(
    category: PlaceCategory =
      this.selectedCategory
  ): Promise<void> {
    this.selectedCategory = category;
    this.errorMessage = '';

    if (
      this.latitude === null ||
      this.longitude === null
    ) {
      await this.getCurrentLocation();
    }

    if (
      this.latitude === null ||
      this.longitude === null
    ) {
      return;
    }

    this.loadingPlaces = true;

    try {
      this.nearbyPlaces =
        await this.placesService.getNearbyPlaces(
          this.latitude,
          this.longitude,
          category,
          this.searchRadiusKm
        );

      this.drawPlaces();

      this.statusMessage =
        this.nearbyPlaces.length > 0
          ? `Se encontraron ${this.nearbyPlaces.length} lugares en un radio de ${this.searchRadiusKm} km.`
          : `No se encontraron lugares en un radio de ${this.searchRadiusKm} km.`;
    } catch (error) {
      this.showError(error);
    } finally {
      this.loadingPlaces = false;
    }
  }

  // Centra el mapa y abre la ventana del lugar seleccionado en la lista.
  focusPlace(place: NearbyPlace): void {
    const marker =
      this.placeMarkers.get(place.id);

    this.map?.setView(
      [place.latitude, place.longitude],
      17
    );

    marker?.openPopup();
  }

  /** Reemplaza los marcadores de lugares y ajusta la vista para incluirlos junto al usuario. */
  private drawPlaces(): void {
    this.placesLayer?.clearLayers();
    this.placeMarkers.clear();

    const bounds: L.LatLngExpression[] = [];

    if (
      this.latitude !== null &&
      this.longitude !== null
    ) {
      bounds.push([
        this.latitude,
        this.longitude
      ]);
    }

    for (const place of this.nearbyPlaces) {
      const coordinates: L.LatLngExpression = [
        place.latitude,
        place.longitude
      ];

      const marker =
        L.circleMarker(coordinates, {
          radius: 7,
          color: '#ffffff',
          weight: 2,
          fillColor: '#16a34a',
          fillOpacity: 1
        });

      // Escapa el texto externo antes de incorporarlo al contenido HTML de la ventana.
      marker.bindPopup(
        `<strong>${this.escapeHtml(
          place.name
        )}</strong><br>` +
        `${this.escapeHtml(
          place.categoryLabel
        )}<br>` +
        `${place.distance.toFixed(2)} km`
      );

      marker.addTo(this.placesLayer!);

      this.placeMarkers.set(
        place.id,
        marker
      );

      bounds.push(coordinates);
    }

    if (bounds.length > 1) {
      this.map?.fitBounds(
        L.latLngBounds(bounds),
        {
          padding: [30, 30],
          maxZoom: 16
        }
      );
    }
  }

  /** Actualiza la vista, guarda la lectura y mueve el marcador y el círculo de precisión. */
  private updatePosition(
    position: Position,
    centerMap: boolean
  ): void {
    this.latitude =
      position.coords.latitude;

    this.longitude =
      position.coords.longitude;

    this.accuracy =
      position.coords.accuracy;

    this.lastUpdate =
      new Date(
        position.timestamp
      ).toLocaleTimeString();

    // Conserva las coordenadas y su timestamp para recuperarlas en futuras solicitudes.
    localStorage.setItem(
      'petcare-last-location',
      JSON.stringify({
        latitude: this.latitude,
        longitude: this.longitude,
        accuracy: this.accuracy,
        timestamp: position.timestamp
      })
    );

    const coordinates: L.LatLngExpression = [
      this.latitude,
      this.longitude
    ];

    if (!this.map) {
      this.initializeMap();
    }

    if (!this.userMarker) {
      this.userMarker =
        L.circleMarker(coordinates, {
          radius: 9,
          color: '#ffffff',
          weight: 3,
          fillColor: '#2563eb',
          fillOpacity: 1
        })
          .addTo(this.map!)
          .bindPopup('Tu ubicación actual');
    } else {
      this.userMarker.setLatLng(coordinates);
    }

    // El radio del círculo representa la precisión estimada por el proveedor, en metros.
    if (!this.accuracyCircle) {
      this.accuracyCircle =
        L.circle(coordinates, {
          radius: this.accuracy,
          color: '#2563eb',
          fillColor: '#60a5fa',
          fillOpacity: 0.16,
          weight: 1
        }).addTo(this.map!);
    } else {
      this.accuracyCircle.setLatLng(
        coordinates
      );

      this.accuracyCircle.setRadius(
        this.accuracy
      );
    }

    // Centra la vista si se solicitó explícitamente o si el seguimiento está activo.
    if (centerMap || this.tracking) {
      this.map!.setView(
        coordinates,
        17
      );
    }
  }

  // Sustituye caracteres especiales para mostrar nombres y categorías como texto.
  private escapeHtml(value: string): string {
    return value.replace(
      /[&<>"']/g,
      (character) => {
        const characters:
          Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
          };

        return characters[character];
      }
    );
  }

  // Registra el error y proporciona un mensaje visible para el usuario.
  private showError(error: unknown): void {
    console.error(
      'Error de localización:',
      error
    );

    this.errorMessage =
      error instanceof Error
        ? error.message
        : 'No fue posible completar la operación.';

    this.statusMessage =
      'Ocurrió un problema.';

    this.loading = false;
  }

  // Detiene el seguimiento y libera el mapa al destruir el componente.
  ngOnDestroy(): void {
    void this.stopTracking();
    this.map?.remove();
    this.map = undefined;
  }
}
