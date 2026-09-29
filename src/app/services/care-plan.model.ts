export const CARE_PLAN_TYPES = [
  'Cita veterinaria',
  'Alimentación',
  'Vacuna',
  'Desparasitación',
  'Medicamento',
  'Peluquería',
  'Paseo',
  'Otro',
  'Control de salud',
] as const;

export type CarePlanType = typeof CARE_PLAN_TYPES[number];
export type CarePlanStatus = 'pending' | 'completed';

export interface CarePlanDraft {
  petId: string;
  type: CarePlanType;
  title: string;
  details: string;
  dueAt: string;
  weightKg: number | null;
  temperatureC: number | null;
  quantity?: string;
  repeatEveryDays?: number | null;
  doseNumber?: number | null;
  nextDoseAt?: string | null;
  generatedFromId?: string | null;
  reminderEnabled?: boolean;
}

export interface CarePlanEntry extends CarePlanDraft {
  id: string;
  petName: string;
  status: CarePlanStatus;
  completedAt: string | null;
  createdAt: string;
}

export function isCarePlanType(value: unknown): value is CarePlanType {
  return typeof value === 'string' && CARE_PLAN_TYPES.includes(value as CarePlanType);
}
