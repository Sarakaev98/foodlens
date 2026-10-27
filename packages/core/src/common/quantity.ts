export type MassUnit = 'g' | 'mg' | 'mcg';
export type VolumeUnit = 'ml' | 'l';
export type EnergyUnit = 'kcal' | 'kJ';

export interface Quantity<U extends string> {
  readonly value: number;
  readonly unit: U;
}

export type Mass = Quantity<MassUnit>;
export type Volume = Quantity<VolumeUnit>;
export type Energy = Quantity<EnergyUnit>;
