import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './home.page';
import { ConnectivityService } from '../services/connectivity.service';
import { environment } from '../../environments/environment';

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn(async () => ({ connected: true, connectionType: 'wifi' })),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  },
}));

describe('HomePage care synchronization', () => {
  let fixture: ComponentFixture<HomePage>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideRouter([])],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function button(text: string): HTMLButtonElement {
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    return [...buttons].find((element) => element.textContent?.includes(text))!;
  }

  async function openHistory() {
    fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    button('Historial').click();
    await fixture.whenStable();
  }

  async function fillCare(description = 'Paseo') {
    const name = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const detail = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    name.value = 'Milo';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    detail.value = description;
    detail.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }

  it('refreshes the button, pending count and success message after an asynchronous response', async () => {
    let resolveRequest!: (value: { ok: boolean }) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    await openHistory();
    await fillCare();
    button('GUARDAR CUIDADO').click();
    await fixture.whenStable();

    expect(button('SINCRONIZANDO').disabled).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.pending-icon')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('petcare.pending-care-records')!)).toHaveLength(1);

    const sending = fixture.componentInstance.careRecords.syncPending();
    resolveRequest({ ok: true });
    await sending;
    await fixture.whenStable();

    // No detectChanges or additional user interaction: this is the original regression.
    expect(button('SINCRONIZAR AHORA').disabled).toBe(false);
    expect(button('GUARDAR CUIDADO').disabled).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('.pending-icon')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('Sincronización completada correctamente.');
    expect(fetchMock.mock.calls[0][0]).toBe(environment.apiUrl);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ petName: 'Milo', description: 'Paseo' });
  });

  it('shows an asynchronous API error and unlocks the button while retaining the record', async () => {
    let rejectRequest!: (reason: Error) => void;
    fetchMock.mockReturnValue(new Promise((_resolve, reject) => { rejectRequest = reject; }));
    await openHistory();
    await fillCare();
    button('GUARDAR CUIDADO').click();
    await fixture.whenStable();
    const sending = fixture.componentInstance.careRecords.syncPending();
    rejectRequest(new TypeError('Failed to fetch'));
    await sending;
    await fixture.whenStable();

    expect(button('SINCRONIZAR AHORA').disabled).toBe(false);
    expect(button('GUARDAR CUIDADO').disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('se reintentará en 15 segundos');
    expect(fixture.nativeElement.querySelector('.sync-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.pending-icon')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('petcare.pending-care-records')!)).toHaveLength(1);
  });

  it('queues in demo offline mode and synchronizes when real network mode is selected', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await openHistory();
    button('Offline').click();
    await fixture.whenStable();
    await fillCare();
    button('GUARDAR CUIDADO').click();
    await fixture.whenStable();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('.pending-icon')).toHaveLength(1);
    expect(button('GUARDAR CUIDADO').disabled).toBe(false);

    button('Red real').click();
    await fixture.whenStable();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelectorAll('.pending-icon')).toHaveLength(0);
    expect(button('SINCRONIZAR AHORA').disabled).toBe(false);
  });

  it('recovers an old pending care record and sends it when demo online is selected', async () => {
    localStorage.setItem('petcare-pendientes', JSON.stringify([
      { id: 'PET-old', tipo: 'Cuidado de Milo', detalle: 'Comida', fecha: '2026-09-24T10:00:00.000Z' },
    ]));
    TestBed.inject(ConnectivityService).setDemoOnline(false);
    fetchMock.mockResolvedValue({ ok: true });
    await openHistory();

    expect(fixture.nativeElement.textContent).toContain('Cuidado de Milo');
    expect(fetchMock).not.toHaveBeenCalled();
    button('En línea').click();
    await fixture.whenStable();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelectorAll('.pending-icon')).toHaveLength(0);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ id: 'PET-old', petName: 'Milo' });
  });

  it('retains the form text and reports a storage failure without sending the record', async () => {
    await openHistory();
    await fillCare();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    button('GUARDAR CUIDADO').click();
    await fixture.whenStable();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('No se pudo guardar el cuidado');
    expect((fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Paseo');
    expect(button('GUARDAR CUIDADO').disabled).toBe(false);
  });
});
