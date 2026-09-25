import catalog from "@/lib/catalog.json";
import type { PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";

// The rules behind a dashboard design edit.
//
// Pure and free of React so the editor, the estimate regeneration and any
// test can all agree on what a swap actually produces.
//
// The catalog is GENERATED from the app's PlantItem.sampleCatalog
// (npm run sync:catalog). Until this feature it carried names, prices and
// thumbnails; `modelName` and `heightMultiplier` were read and thrown away.
// Both are load-bearing here:
//
//   • modelName is the mesh the headset renders, and it is per SIZE, not per
//     plant — Texas Ebony is TexasEbonySm at 15 gal and TexasEbonyMd in
//     every box size.
//   • heightMultiplier IS the entity's uniform scale, and it's per plant.
//     Carry the old scale across a swap and a Texas Ebony renders at a
//     Hopseed's proportions.

export type CatalogSize = {
  size: string;
  price: number;
  laborCost: number;
  heightMultiplier: number;
  modelName: string;
};

export type CatalogPlant = {
  key: string;
  name: string;
  botanicalName: string | null;
  category: string;
  thumbnail: string | null;
  sizes: CatalogSize[];
  matureHeightFt: number | null;
  matureWidthFt: number | null;
};

const data = catalog as unknown as {
  sizeOrder: string[];
  plants: CatalogPlant[];
};

export const SIZE_ORDER: string[] = data.sizeOrder;
export const PLANTS: CatalogPlant[] = [...data.plants].sort((a, b) =>
  a.name.localeCompare(b.name)
);

/** Thumbnail path under public/, or null for a plant without a render. */
export function thumbnailURL(plant: CatalogPlant): string | null {
  return plant.thumbnail ? `/plants/${plant.thumbnail}.webp` : null;
}

// One mesh can belong to several sizes of one plant, so the index maps each
// modelName to its owning plant.
const BY_MODEL = new Map<string, CatalogPlant>();
for (const plant of data.plants) {
  for (const size of plant.sizes) {
    if (size.modelName && !BY_MODEL.has(size.modelName)) {
      BY_MODEL.set(size.modelName, plant);
    }
  }
}

const BY_KEY = new Map(data.plants.map((p) => [p.key, p]));

export function plantForModel(modelName: string): CatalogPlant | null {
  return BY_MODEL.get(modelName) ?? null;
}

export function plantForKey(key: string): CatalogPlant | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * The size a placement is currently on.
 *
 * `containerType` is authoritative when present. Projects saved before that
 * field existed fall back to matching on the mesh — and when a mesh serves
 * several sizes, to the one whose heightMultiplier matches the stored scale,
 * which is the same rule the app uses on load.
 */
export function currentSize(
  plant: CatalogPlant,
  placement: Pick<PlacedPlantJSON, "containerType" | "plantModelName" | "scaleX">
): CatalogSize | null {
  if (placement.containerType) {
    const exact = plant.sizes.find((s) => s.size === placement.containerType);
    if (exact) return exact;
  }
  const sameModel = plant.sizes.filter(
    (s) => s.modelName === placement.plantModelName
  );
  if (sameModel.length === 1) return sameModel[0];
  if (sameModel.length > 1) {
    const scale = placement.scaleX || 1;
    return sameModel.reduce((best, s) =>
      Math.abs(s.heightMultiplier - scale) < Math.abs(best.heightMultiplier - scale)
        ? s
        : best
    );
  }
  return plant.sizes[0] ?? null;
}

/**
 * The size to land on when swapping to a plant that may not offer the one
 * you were on. Aloe Vera has no 24" Box; a designer who was buying a 24" Box
 * tree wants the biggest thing the new plant offers, not its smallest.
 */
export function closestSize(plant: CatalogPlant, wanted: string | null): CatalogSize | null {
  if (plant.sizes.length === 0) return null;
  if (!wanted) return plant.sizes[0];

  const exact = plant.sizes.find((s) => s.size === wanted);
  if (exact) return exact;

  const target = SIZE_ORDER.indexOf(wanted);
  if (target < 0) return plant.sizes[0];

  return plant.sizes.reduce((best, s) => {
    const d = Math.abs(SIZE_ORDER.indexOf(s.size) - target);
    const bd = Math.abs(SIZE_ORDER.indexOf(best.size) - target);
    return d < bd ? s : best;
  });
}

/** Everything an edit writes onto a placement. */
function withSize(placement: PlacedPlantJSON, size: CatalogSize): PlacedPlantJSON {
  return {
    ...placement,
    plantModelName: size.modelName,
    containerType: size.size,
    // Uniform, and from the NEW size's multiplier. This single line is the
    // difference between a correct swap and a Texas Ebony at a Hopseed's
    // proportions.
    scaleX: size.heightMultiplier,
    scaleY: size.heightMultiplier,
    scaleZ: size.heightMultiplier,
  };
}

/** Replace the species, keeping the spot it was planted in. */
export function swapSpecies(
  placement: PlacedPlantJSON,
  to: CatalogPlant
): PlacedPlantJSON | null {
  const size = closestSize(to, placement.containerType ?? null);
  if (!size) return null;
  return withSize(placement, size);
}

/** Change container size within the same species. */
export function changeSize(
  placement: PlacedPlantJSON,
  to: CatalogSize
): PlacedPlantJSON {
  return withSize(placement, to);
}

/* ── Applying edits to a design ───────────────────────────────────────── */

export type DesignEdit =
  | { kind: "swap"; id: string; plantKey: string }
  | { kind: "resize"; id: string; size: string }
  | { kind: "delete"; id: string };

/**
 * Applies a list of edits to a design, in order.
 *
 * Deletes are applied last so a plant can be swapped and then removed in one
 * session without the swap silently failing on a missing row.
 */
export function applyEdits(
  project: ProjectFileJSON,
  edits: DesignEdit[]
): ProjectFileJSON {
  let placements = [...(project.placements ?? [])];

  for (const edit of edits) {
    if (edit.kind === "delete") continue;
    const index = placements.findIndex((p) => p.id === edit.id);
    if (index < 0) continue;
    const placement = placements[index];

    if (edit.kind === "swap") {
      const plant = plantForKey(edit.plantKey);
      if (!plant) continue;
      const next = swapSpecies(placement, plant);
      if (next) placements[index] = next;
    } else {
      const plant = plantForModel(placement.plantModelName);
      const size = plant?.sizes.find((s) => s.size === edit.size);
      if (size) placements[index] = changeSize(placement, size);
    }
  }

  const deleted = new Set(
    edits.filter((e) => e.kind === "delete").map((e) => e.id)
  );
  if (deleted.size > 0) {
    placements = placements.filter((p) => !deleted.has(p.id));
  }

  return { ...project, placements };
}

/** Unit price for a placement, with the org's price book taking precedence. */
export function unitPrice(
  placement: PlacedPlantJSON,
  overridesByName: Record<string, number> = {}
): number | null {
  const plant = plantForModel(placement.plantModelName);
  if (!plant) return null;
  const override = overridesByName[plant.name.toLowerCase()];
  if (override != null) return override;
  return currentSize(plant, placement)?.price ?? null;
}

/** What the plants in a design come to — the AR part of the estimate. */
export function plantsSubtotal(
  project: ProjectFileJSON,
  overridesByName: Record<string, number> = {}
): number {
  const total = (project.placements ?? []).reduce(
    (sum, p) => sum + (unitPrice(p, overridesByName) ?? 0),
    0
  );
  return Math.round(total * 100) / 100;
}
