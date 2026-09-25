import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './home.page';
import { ConnectivityService } from '../services/connectivity.service';

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn(async () => ({ connected: true, connectionType: 'wifi' })),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  },
}));

describe('HomePage pet registration', () => {
  let fixture: ComponentFixture<HomePage>;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({ imports: [HomePage], providers: [provideRouter([])] });
    TestBed.inject(ConnectivityService).setDemoOnline(false);
    fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    button('Ver mis mascotas').click();
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('[aria-label="Agregar mascota"]') as HTMLButtonElement).click();
    await fixture.whenStable();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function button(text: string): HTMLButtonElement {
    return [...fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>]
      .find((element) => element.textContent?.includes(text))!;
  }
  async function input(id: string, value: string) {
    const element = fixture.nativeElement.querySelector('#' + id) as HTMLInputElement;
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }
  async function select(id: string, text: string) {
    const element = fixture.nativeElement.querySelector('#' + id) as HTMLSelectElement;
    element.value = [...element.options].find((option) => option.textContent?.trim() === text)!.value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
  }

  it('opens the form from +, saves all fields offline and opens the correct profile and care form', async () => {
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Nueva mascota');
    await input('pet-name', '  Coco  ');
    await select('pet-species', 'Gato');
    await input('pet-breed', 'Mestizo');
    await select('pet-sex', 'Macho');
    await input('pet-age', '2');
    await input('pet-weight', '4.5');
    button('Guardar mascota').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.pet-card-button')).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('Coco se añadió a tus mascotas.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.network-banner').textContent).toContain('1');
    expect(JSON.parse(localStorage.getItem('petcare.pets')!)[0]).toMatchObject({
      name: 'Coco', species: 'Gato', breed: 'Mestizo', sex: 'Macho', ageYears: 2, weightKg: 4.5, pending: true,
    });
    (fixture.nativeElement.querySelector('[aria-label="Ver ficha de Coco"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Coco');
    expect(fixture.nativeElement.textContent).toContain('4.5 kg');
    expect(fixture.nativeElement.textContent).not.toContain('Temperatura');
    button('Registrar cuidado de Coco').click();
    await fixture.whenStable();
    expect((fixture.nativeElement.querySelector('input') as HTMLInputElement).value).toBe('Coco');
    expect(fixture.nativeElement.textContent).not.toContain('Vacuna registrada');
  });

  it('accepts optional fields left blank and updates the pending label after asynchronous synchronization', async () => {
    await input('pet-name', 'Nala');
    button('Guardar mascota').click();
    await fixture.whenStable();
    expect(JSON.parse(localStorage.getItem('petcare.pets')!)[0]).toMatchObject({
      name: 'Nala', breed: '', sex: 'Sin especificar', ageYears: null, weightKg: null,
    });
    expect(fixture.nativeElement.querySelector('[aria-label="Ver ficha de Nala"]').textContent).toContain('Pendiente');
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    button('En línea').click();
    await fixture.whenStable();
    await fixture.componentInstance.petStore.sync();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[aria-label="Ver ficha de Nala"]').textContent).toContain('Mascota registrada');
    expect(fixture.nativeElement.textContent).not.toContain('Sincronizando mascotas');
  });

  it('keeps the form open for whitespace names and invalid age or weight', async () => {
    await input('pet-name', '   ');
    button('Guardar mascota').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#pet-name').getAttribute('aria-invalid')).toBe('true');
    await input('pet-name', 'Coco');
    await input('pet-age', '-1');
    await input('pet-weight', '0');
    button('Guardar mascota').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Nueva mascota');
    expect(fixture.nativeElement.querySelectorAll('.field-error').length).toBeGreaterThan(0);
    expect(localStorage.getItem('petcare.pets')).toBeNull();
  });

  it('cancels without creating a pet', async () => {
    await input('pet-name', 'Sin guardar');
    button('Cancelar').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Mis mascotas');
    expect(fixture.nativeElement.querySelectorAll('.pet-card-button')).toHaveLength(2);
    expect(localStorage.getItem('petcare.pets')).toBeNull();
  });

  it('retains the entered name and reports a local storage failure', async () => {
    await input('pet-name', 'Coco');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    button('Guardar mascota').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('No se pudo guardar la mascota');
    expect((fixture.nativeElement.querySelector('#pet-name') as HTMLInputElement).value).toBe('Coco');
    expect(fixture.componentInstance.petStore.pets()).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not assign the demo history to a new pet also named Luna', async () => {
    await input('pet-name', 'Luna');
    button('Guardar mascota').click();
    await fixture.whenStable();
    const cards = fixture.nativeElement.querySelectorAll('[aria-label="Ver ficha de Luna"]') as NodeListOf<HTMLButtonElement>;
    cards[1].click();
    await fixture.whenStable();
    button('Registrar cuidado de Luna').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Vacuna registrada');
    expect(fixture.nativeElement.textContent).not.toContain('Lectura del sensor normal');
  });
});
