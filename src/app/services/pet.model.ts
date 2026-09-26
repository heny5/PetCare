export const PET_SPECIES = ['Perro', 'Gato', 'Ave', 'Conejo', 'Otro'] as const;
export const PET_SEXES = ['Hembra', 'Macho', 'Sin especificar'] as const;

export interface PetDraft {
  name: string;
  species: typeof PET_SPECIES[number];
  breed: string;
  sex: typeof PET_SEXES[number];
  ageYears: number | null;
  weightKg: number | null;
}
export interface Pet extends PetDraft { id: string; createdAt: string; }
export interface StoredPet extends Pet { pending: boolean; deleted?: boolean; operation?: 'PUT'; }

export function isPetDraft(value: unknown): value is PetDraft {
  if (!value || typeof value !== 'object') return false;
  const pet = value as PetDraft;
  return typeof pet.name === 'string' && !!pet.name.trim() && pet.name.length <= 80 &&
    PET_SPECIES.includes(pet.species) && PET_SEXES.includes(pet.sex) &&
    typeof pet.breed === 'string' && pet.breed.length <= 80 &&
    (pet.ageYears === null || (Number.isInteger(pet.ageYears) && pet.ageYears >= 0 && pet.ageYears <= 200)) &&
    (pet.weightKg === null || (typeof pet.weightKg === 'number' && Number.isFinite(pet.weightKg) && pet.weightKg > 0));
}
export function isPet(value: unknown): value is Pet {
  if (!isPetDraft(value)) return false;
  const pet = value as Pet;
  return typeof pet.id === 'string' && !!pet.id.trim() &&
    typeof pet.createdAt === 'string' && Number.isFinite(Date.parse(pet.createdAt));
}
export const DEMO_PETS: readonly StoredPet[] = [
  {
    id: 'demo-luna', name: 'Luna', species: 'Perro', breed: 'Beagle', sex: 'Hembra',
    ageYears: 4, weightKg: 12.4, createdAt: '2026-01-01T00:00:00.000Z', pending: false,
  },
  {
    id: 'demo-milo', name: 'Milo', species: 'Gato', breed: 'Gato criollo', sex: 'Macho',
    ageYears: 2, weightKg: null, createdAt: '2026-01-01T00:00:00.000Z', pending: false,
  },
];
