import { Injectable, signal } from '@angular/core';

export interface PetVideoClip {
  id: string;
  owner: string;
  petId: string;
  petName: string;
  caption: string;
  createdAt: string;
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  poster: string;
  url: string;
}

interface StoredPetVideo extends Omit<PetVideoClip, 'url'> {
  blob: Blob;
}

@Injectable({ providedIn: 'root' })
export class PetMediaService {
  static readonly maxDurationSeconds = 60;
  static readonly maxSizeBytes = 35 * 1024 * 1024;

  private readonly clipsState = signal<PetVideoClip[]>([]);
  private databaseTask?: Promise<IDBDatabase>;
  private loadGeneration = 0;
  readonly clips = this.clipsState.asReadonly();

  async loadForPet(owner: string, petId: string): Promise<void> {
    const generation = ++this.loadGeneration;
    this.releaseUrls();
    this.clipsState.set([]);
    if (!owner || !petId) return;

    const database = await this.openDatabase();
    const transaction = database.transaction('videos', 'readonly');
    const request = transaction.objectStore('videos').index('ownerPet').getAll([owner, petId]);
    const stored = await this.requestResult(request) as StoredPetVideo[];
    if (generation !== this.loadGeneration) return;
    const clips = stored
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(({ blob, ...clip }) => ({ ...clip, url: URL.createObjectURL(blob) }));
    this.clipsState.set(clips);
  }

  async addVideo(input: {
    owner: string;
    petId: string;
    petName: string;
    caption: string;
    blob: Blob;
    durationSeconds: number;
    poster?: string;
  }): Promise<void> {
    if (input.blob.size <= 0 || input.blob.size > PetMediaService.maxSizeBytes) {
      throw new Error('El video debe pesar menos de 35 MB.');
    }
    if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > PetMediaService.maxDurationSeconds) {
      throw new Error('El video debe durar 60 segundos o menos.');
    }
    if (!input.owner.trim() || !input.petId || !input.petName.trim()) {
      throw new Error('Selecciona una mascota para guardar el video.');
    }

    const database = await this.openDatabase();
    const record: StoredPetVideo = {
      id: crypto.randomUUID(),
      owner: input.owner.trim(),
      petId: input.petId,
      petName: input.petName.trim(),
      caption: input.caption.trim().slice(0, 120),
      createdAt: new Date().toISOString(),
      durationSeconds: input.durationSeconds,
      sizeBytes: input.blob.size,
      mimeType: input.blob.type || 'video/mp4',
      poster: input.poster ?? '',
      blob: input.blob,
    };
    const transaction = database.transaction('videos', 'readwrite');
    transaction.objectStore('videos').add(record);
    await this.transactionDone(transaction);
    await this.loadForPet(record.owner, record.petId);
  }

  async deleteVideo(id: string): Promise<void> {
    const clip = this.clipsState().find((item) => item.id === id);
    if (!clip) return;
    const database = await this.openDatabase();
    const transaction = database.transaction('videos', 'readwrite');
    transaction.objectStore('videos').delete(id);
    await this.transactionDone(transaction);
    this.revokeUrl(clip.url);
    this.clipsState.update((clips) => clips.filter((item) => item.id !== id));
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databaseTask) return this.databaseTask;
    this.databaseTask = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('petcare-media', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('videos')) {
          const store = database.createObjectStore('videos', { keyPath: 'id' });
          store.createIndex('ownerPet', ['owner', 'petId'], { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el almacenamiento de videos.'));
      request.onblocked = () => reject(new Error('Cierra otras pestañas de PetCare para abrir el almacenamiento de videos.'));
    }).catch((error: unknown) => {
      this.databaseTask = undefined;
      throw error;
    });
    return this.databaseTask;
  }

  private requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('No se pudieron leer los videos guardados.'));
    });
  }

  private transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar el video.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Se canceló el guardado del video.'));
    });
  }

  private releaseUrls(): void {
    for (const clip of this.clipsState()) this.revokeUrl(clip.url);
  }

  private revokeUrl(url: string): void {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}
