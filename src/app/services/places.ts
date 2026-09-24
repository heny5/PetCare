import { Injectable } from '@angular/core';

export type PlaceCategory =
  | 'petStores'
  | 'petFood'
  | 'veterinary';

export interface NearbyPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  category: PlaceCategory;
  categoryLabel: string;
  distance: number;
  address: string;
}

export interface LocationSearchResult {
  name: string;
  latitude: number;
  longitude: number;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: Record<string, string>;
}

@Injectable({
  providedIn: 'root'
})
export class PlacesService {
  private readonly overpassUrl =
    'https://overpass-api.de/api/interpreter';

  private readonly nominatimUrl =
    'https://nominatim.openstreetmap.org/search';

  async getNearbyPlaces(
    latitude: number,
    longitude: number,
    category: PlaceCategory,
    radiusKm: number = 3
  ): Promise<NearbyPlace[]> {
    const safeRadiusKm =
      Math.min(Math.max(radiusKm, 1), 20);

    const radiusMeters = safeRadiusKm * 1000;
    const selectors = this.getOverpassSelectors(category);

    const queries = selectors
      .map(
        (selector) =>
          `${selector}(around:${radiusMeters},${latitude},${longitude});`
      )
      .join('\n');

    const query = `
      [out:json][timeout:25];
      (
        ${queries}
      );
      out center;
    `;

    const url =
      `${this.overpassUrl}?data=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(
        'No fue posible consultar los lugares cercanos.'
      );
    }

    const data = (await response.json()) as {
      elements: OverpassElement[];
    };

    const convertedPlaces = data.elements
      .map((element) =>
        this.convertElement(
          element,
          latitude,
          longitude,
          category
        )
      )
      .filter((place): place is NearbyPlace => place !== null);

    const uniquePlaces = Array.from(
      new Map(
        convertedPlaces.map((place) => [place.id, place])
      ).values()
    );

    return uniquePlaces
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 50);
  }

  async searchLocation(
    searchText: string
  ): Promise<LocationSearchResult[]> {
    const query = searchText.trim();

    if (query.length < 3) {
      throw new Error(
        'Escribe al menos tres caracteres para buscar.'
      );
    }

    const url =
      `${this.nominatimUrl}?format=jsonv2&limit=5` +
      `&accept-language=es&q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(
        'No fue posible realizar la búsqueda.'
      );
    }

    const results = (await response.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
    }>;

    return results.map((result) => ({
      name: result.display_name,
      latitude: Number(result.lat),
      longitude: Number(result.lon)
    }));
  }

  private getOverpassSelectors(
    category: PlaceCategory
  ): string[] {
    switch (category) {
      case 'petStores':
        return [
          'nwr["shop"="pet"]'
        ];

      case 'petFood':
        return [
          'nwr["shop"="pet"]',
          'nwr["shop"="animal_feed"]'
        ];

      case 'veterinary':
        return [
          'nwr["amenity"="veterinary"]'
        ];
    }
  }

  private convertElement(
    element: OverpassElement,
    userLatitude: number,
    userLongitude: number,
    category: PlaceCategory
  ): NearbyPlace | null {
    const latitude =
      element.lat ?? element.center?.lat;

    const longitude =
      element.lon ?? element.center?.lon;

    if (
      latitude === undefined ||
      longitude === undefined
    ) {
      return null;
    }

    const tags = element.tags ?? {};

    return {
      id: `${element.type}-${element.id}`,
      name:
        tags['name'] ??
        tags['brand'] ??
        this.getDefaultName(category),
      latitude,
      longitude,
      category,
      categoryLabel:
        this.getCategoryLabel(category),
      distance: this.calculateDistance(
        userLatitude,
        userLongitude,
        latitude,
        longitude
      ),
      address: this.buildAddress(tags)
    };
  }

  private getDefaultName(
    category: PlaceCategory
  ): string {
    switch (category) {
      case 'petStores':
        return 'Tienda de mascotas';

      case 'petFood':
        return 'Comida para mascotas';

      case 'veterinary':
        return 'Veterinaria';
    }
  }

  private getCategoryLabel(
    category: PlaceCategory
  ): string {
    switch (category) {
      case 'petStores':
        return 'Tienda de mascotas';

      case 'petFood':
        return 'Comida para mascotas';

      case 'veterinary':
        return 'Veterinaria';
    }
  }

  private buildAddress(
    tags: Record<string, string>
  ): string {
    const parts = [
      tags['addr:street'],
      tags['addr:housenumber'],
      tags['addr:city']
    ].filter(Boolean);

    return parts.length > 0
      ? parts.join(', ')
      : 'Dirección no disponible';
  }

  private calculateDistance(
    startLatitude: number,
    startLongitude: number,
    endLatitude: number,
    endLongitude: number
  ): number {
    const earthRadius = 6371;

    const latitudeDifference =
      this.toRadians(
        endLatitude - startLatitude
      );

    const longitudeDifference =
      this.toRadians(
        endLongitude - startLongitude
      );

    const value =
      Math.sin(latitudeDifference / 2) ** 2 +
      Math.cos(this.toRadians(startLatitude)) *
        Math.cos(this.toRadians(endLatitude)) *
        Math.sin(longitudeDifference / 2) ** 2;

    const angle =
      2 *
      Math.atan2(
        Math.sqrt(value),
        Math.sqrt(1 - value)
      );

    return earthRadius * angle;
  }

  private toRadians(value: number): number {
    return value * (Math.PI / 180);
  }
}