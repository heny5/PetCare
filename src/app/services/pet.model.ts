// Opciones admitidas para los campos de especie y sexo de una mascota.
export const PET_SPECIES = ['Perro', 'Gato', 'Ave', 'Conejo', 'Otro'] as const;
export const PET_SEXES = ['Hembra', 'Macho', 'Sin especificar'] as const;

/** Datos editables de la ficha; la edad se expresa en años y el peso en kilogramos. */
export interface PetDraft {
  name: string;
  species: typeof PET_SPECIES[number];
  breed: string;
  sex: typeof PET_SEXES[number];
  ageYears: number | null;
  weightKg: number | null;
  dateOfBirth?: string | null;
  importantNotes?: string;
}
// Una ficha guardada agrega su identificador y la fecha de creación.
export interface Pet extends PetDraft { id: string; createdAt: string; }
// Metadatos utilizados para representar el estado de almacenamiento de la ficha.
export interface StoredPet extends Pet { pending: boolean; deleted?: boolean; operation?: 'PUT'; }

/** Comprueba tipos, opciones permitidas y límites de los datos de una mascota. */
export function isPetDraft(value: unknown): value is PetDraft {
  if (!value || typeof value !== 'object') return false;
  const pet = value as PetDraft;
  return typeof pet.name === 'string' && !!pet.name.trim() && pet.name.length <= 80 &&
    PET_SPECIES.includes(pet.species) && PET_SEXES.includes(pet.sex) &&
    typeof pet.breed === 'string' && pet.breed.length <= 80 &&
    (pet.ageYears === null || (Number.isInteger(pet.ageYears) && pet.ageYears >= 0 && pet.ageYears <= 200)) &&
    (pet.weightKg === null || (typeof pet.weightKg === 'number' && Number.isFinite(pet.weightKg) && pet.weightKg > 0)) &&
    (pet.dateOfBirth === undefined || pet.dateOfBirth === null || pet.dateOfBirth === '' || isValidDateOfBirth(pet.dateOfBirth)) &&
    (pet.importantNotes === undefined || (typeof pet.importantNotes === 'string' && pet.importantNotes.length <= 1000));
}

// Acepta fechas reales con formato AAAA-MM-DD que no sean posteriores al día actual.
function isValidDateOfBirth(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value &&
    value <= new Date().toISOString().slice(0, 10);
}

/** Valida la ficha completa, incluido un identificador y una fecha de creación válidos. */
export function isPet(value: unknown): value is Pet {
  if (!isPetDraft(value)) return false;
  const pet = value as Pet;
  return typeof pet.id === 'string' && !!pet.id.trim() &&
    typeof pet.createdAt === 'string' && Number.isFinite(Date.parse(pet.createdAt));
}
