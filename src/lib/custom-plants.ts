// Placeholder plants — designer-created stand-ins for species the 3D
// library doesn't cover yet. Stored per-org in public.custom_plants
// (migration 013); see src/lib/placeholder-symbols.tsx for the symbol
// vocabulary they draw with.

import type { CatalogPlant } from "@/lib/price-stats";

export type CustomPlantSize = {
  size: string;
  price: number;
  installedHeightFt: number | null;
};

export type CustomPlant = {
  id: string;
  name: string;
  botanical_name: string | null;
  key: string;
  symbol: string;
  mature_height_ft: number | null;
  mature_width_ft: number | null;
  sizes: CustomPlantSize[];
  photo_path: string | null;
  notes: string | null;
  status: "draft" | "ready";
  updated_at: string;
};

// A placeholder rendered through the same card/detail components as a real
// catalog plant. `custom` carries the fields only placeholders have.
export type LibraryPlant = CatalogPlant & {
  custom: CustomPlant | null;
  photoUrl: string | null;
};

export function toLibraryPlant(
  plant: CustomPlant,
  photoUrl: string | null
): LibraryPlant {
  return {
    key: plant.key,
    name: plant.name,
    botanicalName: plant.botanical_name,
    category: "Placeholder",
    thumbnail: null,
    sizes: plant.sizes.map((s) => ({
      size: s.size,
      price: s.price,
      laborCost: 0,
    })),
    matureHeightFt: plant.mature_height_ft,
    matureWidthFt: plant.mature_width_ft,
    sun: null,
    water: null,
    origin: null,
    description: plant.notes,
    coldToleranceFahrenheit: null,
    bloomPeriod: null,
    growthRate: null,
    lifespan: null,
    custom: plant,
    photoUrl,
  };
}

export function toLibraryPlants(plants: CatalogPlant[]): LibraryPlant[] {
  return plants.map((p) => ({ ...p, custom: null, photoUrl: null }));
}
