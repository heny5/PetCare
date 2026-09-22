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
  latitude: number | null = null;
  longitude: number | null = null;
  accuracy: number | null = null;
  lastUpdate = '';

  loading = false;
  tracking = false;
  loadingPlaces = false;
  searching = false;

  statusMessage =
    'Presiona “Obtener ubicación” para activar el GPS.';
  errorMessage = '';

  searchText = '';
  searchResults: LocationSearchResult[] = [];

  selectedCategory: PlaceCategory = 'petStores';
  searchRadiusKm = 3;
  nearbyPlaces: NearbyPlace[] = [];

  private map?: L.Map;
  private userMarker?: L.CircleMarker;
  private searchMarker?: L.CircleMarker;
  private accuracyCircle?: L.Circle;
  private placesLayer?: L.LayerGroup;
  private watchId: string | null = null;

  private placeMarkers =
    new Map<string, L.CircleMarker>();

  constructor(
    private ngZone: NgZone,
    private placesService: PlacesService
  ) {}

  private getPositionOptions() {
    const isNative = Capacitor.isNativePlatform();

    return {
      enableHighAccuracy: isNative,
      timeout: isNative ? 30000 : 12000,
      maximumAge: isNative ? 0 : 60000
    };
  }

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

  ionViewDidEnter(): void {
    setTimeout(() => this.initializeMap(), 150);
  }

  private initializeMap(): void {
    if (this.map) {
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

  private async verifyPermission(): Promise<void> {
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
            this.ngZone.run(() => {
              if (error) {
                this.showError(error);
                return;
              }

              if (position) {
                const previousAccuracy = this.accuracy;
                const newAccuracy = position.coords.accuracy;

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

  focusPlace(place: NearbyPlace): void {
    const marker =
      this.placeMarkers.get(place.id);

    this.map?.setView(
      [place.latitude, place.longitude],
      17
    );

    marker?.openPopup();
  }

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

    if (centerMap || this.tracking) {
      this.map!.setView(
        coordinates,
        17
      );
    }
  }

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

  ngOnDestroy(): void {
    void this.stopTracking();
    this.map?.remove();
    this.map = undefined;
  }
}
