"use client";

// Living-blueprint 3D viewer: draws the ProjectFile the Vision Pro app
// syncs (placements, boundary, features, hardscape) as a stylized
// architectural drawing — sand paper, verde ink, gold selection. The
// headset owns photorealism; this is the blueprint come to life.
//
// Hand-rolled canvas projection on purpose: the stylized look needs no
// meshes, lighting, or textures, so three.js would be dead weight. If we
// ever want real 3D assets in the browser, that's the moment to switch.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import type { ProjectFileJSON } from "./types";
import { buildScene, buildRail, type Instance } from "./scene";
import { sizeFactor } from "./catalog";
import {
  symbolFor,
  drawPlanSymbol,
  symbolPath3D,
  edgeRadius,
  rngFor,
  type PlanSymbol,
} from "./symbols";

/* ── Brand-locked palette (matches globals.css / the marketing site).
      The viewer is a Verde Vision document — it does not follow the OS
      theme the way the rest of the dashboard does. ───────────────── */
const SAND = "#ebe0cb";
const GROUND = "#e4d8bc";
const VERDE = "#2e5d43";
const INK = "#1c2a21";
const GOLD = "#a87b2f";
const WATER_FILL = "rgba(122,163,178,0.55)";
const WATER_LINE = "#5e93a8";
const CLAY = "#b0552f";

// A succulent's leaves are opaque and they overlap. Everything else in this
// viewer is drawn in outline and left see-through, but a rosette drawn that
// way shows every hidden leaf base at once and collapses into a tangle —
// the overlap IS the plant. Near-opaque paper under the tint lets the front
// bracts cover the ones behind, which is what the depth sort is for.
const LEAF_BODY = "rgba(235,224,203,0.93)";

const verde = (a: number) => `rgba(46,93,67,${a})`;
const gold = (a: number) => `rgba(168,123,47,${a})`;
const ink = (a: number) => `rgba(28,42,33,${a})`;

/* ── Component ──────────────────────────────────────────────────── */

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type LivingBlueprintProps = {
  project: ProjectFileJSON;
  projectName: string;
  estimateAmount?: number | null;
  /** The org's grid prices, "plant_key|size" → price (PriceBook.prices). A
   *  blank cell is $0, as on the estimate and the headset. */
  priceOverrides?: Record<string, number>;
  showPrices: boolean;
  backHref?: string | null;
  /**
   * Called instead of following backHref when the editor has unpublished
   * changes. Those live only in this tab, so leaving loses them — and the
   * one place that knows is the editor, not this component.
   */
  onBeforeLeave?: (() => boolean) | null;
  // Hrefs for the project's PDF documents (2D blueprint, itemized
  // estimate). Null/absent entries render no button.
  documents?: { blueprint: string | null; estimate: string | null } | null;
  // Canvas-only preview: no header, rail, or interaction — a slow orbit
  // instead. Used as the clickable 3D card on the project page.
  embed?: boolean;

  // ── Editing ──
  // Supplied by the design editor that wraps this component. The viewer
  // stays a renderer: it reports which plant was clicked and draws the
  // selection and the ghosts, but owns none of the edit state.
  editing?: boolean;
  selectedId?: string | null;
  onSelectInstance?: (id: string | null) => void;
  /** Absent means the Edit control isn't offered at all. */
  onToggleEditing?: () => void;
  /** Replaces the plant-material rail while editing. The rail groups by
   *  species, so it can't address the single plant an editor works on. */
  editorPanel?: React.ReactNode;
};



/** Convex hull, Andrew's monotone chain. A barrel cactus is a convex body,
 *  so its outline on screen is the hull of its surface — which stays right
 *  at any camera angle, where a drawn ellipse is only right from straight
 *  on and goes wrong the moment the view tips. */
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number],
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src: [number, number][]) => {
    const out: [number, number][] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0)
        out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** White Dawn lantana: mid-dark green trailing runners, greenish-brown
 *  stems, and white posies with a yellow eye. */
const WHITE_DAWN_COLOURS = {
  leafLit: [150, 166, 116],
  leafShade: [48, 58, 42],
  inner: [38, 46, 34],
  stem: "rgba(98,86,64,0.85)",
  flower: "rgb(244,242,232)",
  floret: "rgb(252,251,246)",
  eye: "rgb(218,182,72)",
};
const WHITE_DAWN_GOLD = {
  leafLit: [226, 192, 120],
  leafShade: [152, 114, 54],
  inner: [118, 86, 40],
  stem: "rgba(168,123,47,0.85)",
  flower: "rgb(244,222,166)",
  floret: "rgb(250,232,184)",
  eye: "rgb(168,123,47)",
};

/** Purple lantana: a dense olive mound of small leaves, its lavender flower
 *  heads all over it, each a ring of florets with a pale eye. The scan's
 *  colours, the flowers a little clearer than its washed lavender. */
const PURPLE_LANTANA_COLOURS = {
  leafLit: [150, 162, 100],
  leafShade: [40, 43, 36],
  inner: [32, 35, 28],
  core: "rgb(36,40,31)",
  flowerLit: [214, 194, 222],
  flower: [174, 140, 184],
  flowerShade: [112, 84, 118],
  eye: "rgb(240,232,204)",
};
const PURPLE_LANTANA_GOLD = {
  leafLit: [226, 192, 120],
  leafShade: [150, 112, 52],
  inner: [116, 84, 38],
  core: "rgb(104,76,34)",
  flowerLit: [252, 238, 200],
  flower: [240, 214, 150],
  flowerShade: [196, 160, 92],
  eye: "rgb(255,248,226)",
};

/** Yellow lantana: the purple's dark green leaves, smothered in golden
 *  heads — a third of what the scan shows is flower. Each head a ring of
 *  golden florets round a deeper amber heart of buds. */
const YELLOW_LANTANA_COLOURS = {
  leafLit: [144, 154, 98],
  leafShade: [40, 44, 34],
  inner: [31, 35, 27],
  core: "rgb(34,38,29)",
  flowerLit: [240, 204, 128],
  flower: [212, 160, 78],
  flowerShade: [146, 100, 44],
  bud: [208, 136, 56],
  eye: "rgb(186,116,44)",
};
const YELLOW_LANTANA_GOLD = {
  leafLit: [226, 192, 120],
  leafShade: [150, 112, 52],
  inner: [116, 84, 38],
  core: "rgb(104,76,34)",
  flowerLit: [252, 238, 200],
  flower: [240, 214, 150],
  flowerShade: [196, 160, 92],
  bud: [226, 190, 120],
  eye: "rgb(196,150,72)",
};

/** Ocotillo in leaf and flower, as the app's model is: pale grey bark, small
 *  bright green leaves the length of every cane (a few yellowing), scarlet
 *  tubes at the tips. Measured off the model's render. */
const OCOTILLO_COLOURS = {
  crown: "rgb(140,130,108)",
  bark: "rgb(164,158,140)",
  barkLit: "rgb(204,200,186)",
  sleeve: "rgb(56,74,38)",
  leafBack: "rgb(66,86,44)",
  leaf: ["rgb(78,100,50)", "rgb(96,120,60)", "rgb(114,138,72)", "rgb(134,156,90)", "rgb(152,146,78)"],
  flower: "rgb(192,66,44)",
  flowerLit: "rgb(228,110,74)",
};
/** Beaked Yucca as the app's mature model is: a ball of dark green blades,
 *  a skirt of straw-coloured dead leaves, a short brown trunk. Measured off
 *  the model's render. */
const BEAKED_YUCCA_COLOURS = {
  trunk: "rgb(120,106,86)",
  trunkLit: "rgb(152,136,110)",
  trunkLine: "rgb(88,76,60)",
  skirt: "rgb(140,126,102)",
  skirtLit: "rgb(178,164,138)",
  straw: ["rgb(116,102,80)", "rgb(150,136,112)", "rgb(184,170,144)"],
  core: "rgb(30,42,22)",
  back: ["rgb(38,54,26)", "rgb(48,66,32)"],
  blade: ["rgb(50,70,30)", "rgb(60,82,34)", "rgb(72,94,40)", "rgb(92,114,50)", "rgb(118,142,62)"],
  edge: "rgb(46,64,30)",
};
const BEAKED_YUCCA_GOLD = {
  trunk: "rgb(150,112,52)",
  trunkLit: "rgb(196,160,96)",
  trunkLine: "rgb(120,88,40)",
  skirt: "rgb(196,160,96)",
  skirtLit: "rgb(232,206,150)",
  straw: ["rgb(170,130,62)", "rgb(206,170,104)", "rgb(236,210,156)"],
  core: "rgb(120,88,40)",
  back: ["rgb(140,104,46)", "rgb(160,122,58)"],
  blade: ["rgb(170,130,62)", "rgb(190,150,78)", "rgb(210,172,100)", "rgb(228,196,128)", "rgb(240,214,150)"],
  edge: "rgb(140,104,46)",
};
/** Golden Barrel as the app's scan is: from any distance a ball of pale
 *  gold spines; close to, a dark green body under them and cream wool at
 *  the areoles and the crown. Flank tones shade to lit, far off and near;
 *  measured off the scan's render. */
const GOLDEN_BARREL_COLOURS = {
  far: [[96, 84, 50], [130, 112, 68], [160, 138, 88], [188, 164, 110], [212, 192, 136]],
  body: [[56, 60, 30], [74, 80, 40], [94, 100, 52], [116, 120, 64], [138, 140, 78]],
  groove: "rgb(50,50,28)",
  ridge: "rgb(222,200,140)",
  spine: "rgb(190,158,92)",
  spineLit: "rgb(236,212,150)",
  wool: "rgb(236,220,180)",
  crown: "rgb(228,206,160)",
  crownHeart: "rgb(222,194,150)",
};
const GOLDEN_BARREL_GOLD = {
  far: [[150, 112, 52], [176, 136, 66], [200, 160, 90], [222, 188, 120], [240, 214, 150]],
  body: [[120, 88, 40], [140, 104, 46], [160, 122, 58], [182, 144, 74], [204, 168, 96]],
  groove: "rgb(110,80,36)",
  ridge: "rgb(244,224,170)",
  spine: "rgb(206,170,104)",
  spineLit: "rgb(248,232,190)",
  wool: "rgb(250,238,206)",
  crown: "rgb(244,226,184)",
  crownHeart: "rgb(232,196,140)",
};
const OCOTILLO_GOLD = {
  crown: "rgb(150,112,52)",
  bark: "rgb(196,160,96)",
  barkLit: "rgb(232,206,150)",
  sleeve: "rgb(140,104,46)",
  leafBack: "rgb(150,112,52)",
  leaf: ["rgb(170,130,62)", "rgb(196,156,84)", "rgb(218,180,108)", "rgb(236,206,140)", "rgb(240,214,150)"],
  flower: "rgb(240,214,150)",
  flowerLit: "rgb(252,238,200)",
};

/** The aloe's flower spikes, on the lantana's terms: confined to the flowers,
 *  muted to sit on the sand, and absent from the plan symbol. A tall stalk of
 *  hanging yellow tubes is what tells an aloe from an agave at a glance —
 *  in ink alone the spike is a bottle brush of any colour. Open flowers, and
 *  the greener buds still closed at the tip. */
const ALOE_BLOOM = "rgba(222,184,74,0.88)";
const ALOE_BUD = "rgba(178,180,98,0.88)";

/** Shrub foliage, on the same terms: muted, 3D only, gold under selection.
 *  A shrub is a mass of leaves, and in ink alone one shrub is every shrub —
 *  the green, and how it goes from lit to shadow, is most of what tells a
 *  hopseed from a sage at a glance. RGB, mixed per spray by its light. */
const HOPSEED_LEAF = {
  lit: [118, 148, 88],
  shade: [50, 82, 54],
  fresh: [160, 182, 104], // the paler new growth at the top
  core: [36, 60, 42], // the shadow inside the mass
};
const HOPSEED_GOLD = {
  lit: [226, 192, 120],
  shade: [152, 114, 54],
  fresh: [236, 212, 146],
  core: [118, 86, 40],
};

/** Texas sage: lavender bloom over woolly silver leaves — the model is in
 *  flower, as the plant is for weeks after every monsoon. */
const SAGE_COLOURS = {
  core: [150, 140, 170], // the dense middle, seen between the tufts
  bloomLit: [184, 166, 222],
  bloomShade: [122, 104, 164],
  bloomPale: [222, 212, 242], // the open flowers catching the light
  leafLit: [206, 212, 196],
  leafShade: [142, 152, 134],
};
const SAGE_GOLD = {
  core: [170, 132, 66],
  bloomLit: [228, 196, 128],
  bloomShade: [156, 118, 58],
  bloomPale: [240, 220, 160],
  leafLit: [222, 200, 140],
  leafShade: [150, 120, 64],
};

/** Yellow bells: deep glossy green, and the golden trumpets it's named for. */
const YELLOW_BELLS_COLOURS = {
  core: [58, 90, 52],
  leafLit: [128, 168, 82],
  leafShade: [56, 94, 52],
  bloomLit: [232, 190, 62],
  bloomShade: [184, 136, 36],
};
const YELLOW_BELLS_GOLD = {
  core: [118, 86, 40],
  leafLit: [226, 192, 120],
  leafShade: [152, 114, 54],
  bloomLit: [244, 222, 160],
  bloomShade: [196, 158, 86],
};

/** Red bird of paradise: dark fern-green fronds, scarlet ruffled blooms
 *  edged in gold, and the pale bark of its open stems. */
const RED_BIRD_COLOURS = {
  deep: [40, 70, 44], // fronds inside the canopy
  leafLit: [98, 140, 84],
  leafShade: [50, 88, 56],
  bloomLit: [228, 82, 52],
  bloomShade: [176, 50, 36],
  edge: "rgba(236,170,56,0.95)", // the gold rim of the petals
  stamen: "rgba(196,40,32,0.85)",
  stem: "rgba(150,132,112,0.9)",
};
const RED_BIRD_GOLD = {
  deep: [118, 86, 40],
  leafLit: [226, 192, 120],
  leafShade: [152, 114, 54],
  bloomLit: [244, 222, 160],
  bloomShade: [196, 158, 86],
  edge: "rgba(168,123,47,0.9)",
  stamen: "rgba(168,123,47,0.8)",
  stem: "rgba(168,123,47,0.8)",
};

/** Jojoba: the dull grey-green of a shrub that turns its leaves edge-on to
 *  the sun, mottled, over the grey of its twigs. No flowers worth drawing. */
const JOJOBA_COLOURS = {
  core: [76, 88, 77], // the shadow inside the mound — darker than any leaf, or the shaded side melts into it
  leafLit: [190, 198, 178],
  leafShade: [112, 124, 108],
  twig: "rgba(104,94,80,0.8)",
  stem: "rgba(84,80,70,0.5)",
};
const JOJOBA_GOLD = {
  core: [118, 86, 40],
  leafLit: [226, 192, 120],
  leafShade: [152, 114, 54],
  twig: "rgba(168,123,47,0.8)",
  stem: "rgba(168,123,47,0.5)",
};

/** Little John bottlebrush: dark blue-green needles, paler yellow-green at
 *  the growing tips, and the crimson brushes it's named for. */
const BOTTLEBRUSH_COLOURS = {
  core: [46, 60, 54], // the shadow at the heart of the mound
  leafLit: [138, 150, 128],
  leafShade: [62, 76, 70],
  tip: [176, 182, 124], // new growth
  stem: "rgba(96,84,72,0.85)",
  brush: "rgb(146,20,36)", // the flower spike under its stamens
  stamen: "rgba(214,42,54,0.95)",
};
const BOTTLEBRUSH_GOLD = {
  core: [118, 86, 40],
  leafLit: [226, 192, 120],
  leafShade: [152, 114, 54],
  tip: [240, 216, 150],
  stem: "rgba(168,123,47,0.8)",
  brush: "rgb(168,123,47)",
  stamen: "rgba(236,206,140,0.95)",
};

/** Blue palo verde: the misty sage of a canopy that's mostly fine green
 *  twigs, the smooth pale bark it's named for, and a light spring bloom. */
const PALO_VERDE_COLOURS = {
  lit: [210, 216, 186],
  shade: [124, 140, 114],
  bloom: "rgb(224,208,138)",
  trunk: "rgb(156,162,138)",
  limb: "rgba(122,142,112,0.95)",
  twig: "rgba(128,148,118,0.8)",
};
const PALO_VERDE_GOLD = {
  lit: [232, 204, 140],
  shade: [160, 122, 60],
  bloom: "rgb(246,226,170)",
  trunk: "rgb(196,150,70)",
  limb: "rgba(186,138,60,0.95)",
  twig: "rgba(196,150,70,0.8)",
};

/** Honey mesquite: fresh yellow-green feathery leaves, the dark rough grey
 *  of its trunk and crooked limbs, and pale catkins of bloom. */
const MESQUITE_COLOURS = {
  lit: [182, 194, 132],
  shade: [88, 114, 64],
  bloom: "rgb(218,212,158)",
  trunk: "rgb(104,94,86)",
  limb: "rgba(112,102,94,0.95)",
  twig: "rgba(126,118,106,0.8)",
  strand: "rgba(112,138,80,0.75)",
};
const MESQUITE_GOLD = {
  lit: [232, 204, 140],
  shade: [160, 122, 60],
  bloom: "rgb(246,226,170)",
  trunk: "rgb(176,128,56)",
  limb: "rgba(186,138,60,0.95)",
  twig: "rgba(196,150,70,0.8)",
  strand: "rgba(196,150,70,0.75)",
};

/** Texas ebony: the darkest green in the catalog, a near-black canopy lit
 *  by small bright leaflets, its brown pods, and a pale trunk. */
const EBONY_COLOURS = {
  core: [30, 44, 34], // the shadow inside the crown
  shade: [36, 54, 40],
  lit: [80, 108, 70],
  fleckShade: [52, 78, 48],
  fleckLit: [128, 158, 94],
  pod: "rgb(164,114,80)",
  trunk: "rgb(152,142,132)",
  limb: "rgba(128,118,108,0.95)",
};
// Every container size is its own model; the viewer draws them all at the
// mature size, so all three take the mature tree's body.
const EBONY_MODELS = new Set(["TexasEbonySm", "TexasEbonyMd", "TexasEbonyLg"]);
const EBONY_GOLD = {
  core: [118, 86, 40],
  shade: [140, 104, 50],
  lit: [210, 170, 100],
  fleckShade: [170, 130, 64],
  fleckLit: [240, 214, 150],
  pod: "rgb(120,80,30)",
  trunk: "rgb(196,150,70)",
  limb: "rgba(186,138,60,0.95)",
};

/** Mulga: the palest crown in the catalog — silver-grey phyllodes — over
 *  the reddish-brown of its leader and branches. */
const MULGA_COLOURS = {
  lit: [204, 216, 206],
  shade: [124, 142, 134],
  trunk: "rgb(140,108,96)",
  limb: "rgba(142,110,98,0.95)",
  twig: "rgba(150,124,112,0.8)",
};
const MULGA_GOLD = {
  lit: [232, 204, 140],
  shade: [160, 122, 60],
  trunk: "rgb(176,128,56)",
  limb: "rgba(186,138,60,0.95)",
  twig: "rgba(196,150,70,0.8)",
};
// The sapling and the mature tree are separate models; the viewer draws
// every size mature, so both take the mature body.
const MULGA_MODELS = new Set(["MulgaAcaciaSm", "MulgaAcaciaLg"]);

/** Chaste tree: a soft grey-green crown of palmate leaves, crowned all
 *  summer with lavender flower spikes, on slim grey-brown trunks. */
const CHASTE_COLOURS = {
  shade: [56, 80, 52],
  lit: [112, 142, 92],
  leafShade: [80, 112, 70],
  leafLit: [176, 202, 146],
  spikeShade: [126, 108, 188],
  spikeLit: [198, 182, 240],
  trunk: "rgb(132,118,104)",
  limb: "rgba(126,114,102,0.95)",
};
const CHASTE_GOLD = {
  shade: [140, 104, 50],
  lit: [210, 170, 100],
  leafShade: [170, 130, 64],
  leafLit: [240, 214, 150],
  spikeShade: [214, 182, 120],
  spikeLit: [252, 240, 204],
  trunk: "rgb(176,128,56)",
  limb: "rgba(186,138,60,0.95)",
};

/** Mexican fence post: mid-green ribbed stems, every rib crest lined with
 *  the white felt of its fused areoles — the stripes it's named for. */
const FENCE_POST_COLOURS = {
  shade: [60, 98, 58],
  lit: [152, 190, 114],
  felt: "rgb(234,230,214)",
  feltShade: "rgb(172,172,156)",
};
const FENCE_POST_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  felt: "rgb(252,244,218)",
  feltShade: "rgb(212,186,134)",
};

/** Organ pipe: a dark grey-green, its many low ribs catching the light in
 *  fine lines, paler at the tips with new growth and grey spines. */
const ORGAN_PIPE_COLOURS = {
  shade: [52, 68, 60],
  lit: [150, 168, 138],
  tip: [184, 190, 152],
  spines: "rgba(206,206,192,0.55)",
};
const ORGAN_PIPE_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  tip: [252, 230, 172],
  spines: "rgba(255,244,214,0.6)",
};

/** Argentine toothpick: a light olive green, bristling with the long tan
 *  spines it's named for, a reddish crown of them at every tip. */
const TOOTHPICK_COLOURS = {
  shade: [104, 126, 74],
  lit: [200, 214, 144],
  spine: "rgba(224,198,152,0.9)",
  tuft: "rgba(192,128,94,0.95)",
};
const TOOTHPICK_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  spine: "rgba(255,240,206,0.9)",
  tuft: "rgba(214,160,90,0.95)",
};

/** Totem pole: the scan's pale yellow-sage, every knob lit on its
 *  shoulder and shadowed under its drip, deep olive in the creases. */
const TOTEM_COLOURS = {
  shade: [98, 100, 58],
  lit: [218, 220, 160],
  crease: "rgb(80,82,46)",
};
const TOTEM_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  crease: "rgb(116,80,36)",
};

/** Madagascar palm: long strap leaves, yellow-green on top with a pale
 *  midrib, duller olive beneath, over a grey-brown trunk of pale spines. */
const MADAGASCAR_COLOURS = {
  shade: [72, 82, 40],
  lit: [192, 202, 112],
  under: [98, 108, 60],
  underLit: [176, 184, 118],
  midrib: "rgba(222,226,170,0.7)",
  heart: "rgb(58,58,36)",
  bark: [82, 70, 60],
  barkLit: [182, 164, 140],
  spine: "rgba(220,216,202,0.6)",
};
const MADAGASCAR_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  under: [126, 90, 42],
  underLit: [214, 178, 112],
  midrib: "rgba(255,240,200,0.85)",
  heart: "rgb(112,78,36)",
  bark: [126, 88, 40],
  barkLit: [226, 186, 120],
  spine: "rgba(255,240,206,0.85)",
};

/** Firestick: the scan's pencil sticks — the old wood pale grey, the
 *  branches straw-tan, the young growth up top green. Each as its shaded
 *  and lit side. */
const FIRESTICK_COLOURS = {
  wood: [[156, 150, 136], [228, 224, 210]],
  straw: [[160, 140, 106], [230, 214, 178]],
  young: [[108, 120, 66], [178, 188, 118]],
};
const FIRESTICK_GOLD = {
  wood: [[150, 112, 56], [246, 222, 170]],
  straw: [[140, 100, 46], [236, 200, 128]],
  young: [[130, 96, 40], [226, 190, 112]],
};

/** Aloe ferox: thick glaucous leaves, olive grey-green, the undersides a
 *  little duller; red-brown teeth down every margin; a skirt of dead leaves
 *  gone brown at the foot. */
const FEROX_COLOURS = {
  upper: [[96, 106, 86], [196, 204, 176]],
  under: [[80, 88, 70], [170, 178, 152]],
  dead: [[72, 54, 42], [160, 130, 100]],
  core: "rgb(48,54,42)",
  margin: "rgba(132,70,46,0.6)",
  teeth: "rgb(150,74,44)",
};
const FEROX_GOLD = {
  upper: [[140, 100, 46], [236, 200, 128]],
  under: [[126, 90, 42], [214, 178, 112]],
  dead: [[110, 76, 36], [200, 160, 96]],
  core: "rgb(100,70,30)",
  margin: "rgba(140,90,36,0.6)",
  teeth: "rgb(128,78,28)",
};

/** Tropical agave: variegated — cream margins down every leaf with a broad
 *  grey-green stripe between them, on both faces; the undersides' margins
 *  paler and greener. */
const TROPICAL_AGAVE_COLOURS = {
  cream: [[150, 146, 100], [236, 230, 176]],
  green: [[98, 112, 84], [180, 196, 158]],
  under: [[126, 132, 92], [208, 210, 170]],
  spine: "rgb(96,72,52)",
};
const TROPICAL_AGAVE_GOLD = {
  cream: [[160, 120, 60], [248, 220, 150]],
  green: [[130, 94, 40], [222, 186, 108]],
  under: [[126, 90, 42], [214, 178, 112]],
  spine: "rgb(110,76,30)",
};

/** Agave americana: glaucous blue-grey, the old outer leaves gone dusty tan,
 *  dead ones brown on the ground; dark brown teeth and terminal spines. */
const AMERICANA_COLOURS = {
  upper: [[86, 100, 96], [204, 214, 206]],
  under: [[76, 90, 86], [176, 188, 182]],
  dustyUpper: [[96, 92, 76], [200, 192, 166]],
  dustyUnder: [[86, 82, 68], [176, 168, 144]],
  dead: [[90, 68, 50], [176, 148, 112]],
  core: "rgb(46,56,54)",
  margin: "rgba(96,66,46,0.55)",
  teeth: "rgb(98,66,44)",
  spine: "rgb(64,48,38)",
};
const AMERICANA_GOLD = {
  upper: [[140, 100, 46], [236, 200, 128]],
  under: [[126, 90, 42], [214, 178, 112]],
  dustyUpper: [[146, 104, 50], [240, 206, 140]],
  dustyUnder: [[130, 92, 44], [218, 182, 118]],
  dead: [[110, 76, 36], [200, 160, 96]],
  core: "rgb(100,70,30)",
  margin: "rgba(140,90,36,0.6)",
  teeth: "rgb(118,74,26)",
  spine: "rgb(96,62,22)",
};

/** Agave truncata: pale glaucous blue-grey above, the backs a creamy sage;
 *  fine red-brown teeth and a stout red-brown spine at every tip. */
const TRUNCATA_COLOURS = {
  upper: [[104, 118, 112], [204, 214, 206]],
  under: [[122, 130, 118], [222, 218, 190]],
  core: "rgb(58,70,66)",
  margin: "rgba(132,96,72,0.5)",
  teeth: "rgb(128,78,58)",
  spine: "rgb(92,52,38)",
};
const TRUNCATA_GOLD = {
  upper: [[140, 100, 46], [236, 200, 128]],
  under: [[126, 90, 42], [214, 178, 112]],
  core: "rgb(100,70,30)",
  margin: "rgba(140,90,36,0.6)",
  teeth: "rgb(118,74,26)",
  spine: "rgb(96,62,22)",
};

/** AZ Boulder: the scan's granite, a pinkish grey-tan, stained rust low
 *  down where it sat in the soil, flecked dark and white close up. */
const AZ_ROCK_COLOURS = {
  shade: [120, 104, 94],
  lit: [214, 200, 186],
  stain: [134, 96, 74],
  edge: "rgba(84,70,62,0.95)",
  crease: "rgba(92,78,70,0.45)",
  dark: "rgba(74,66,62,0.42)",
  light: "rgba(252,248,240,0.6)",
};
const AZ_ROCK_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  stain: [150, 96, 40],
  edge: "rgba(122,86,30,0.95)",
  crease: "rgba(122,86,30,0.45)",
  dark: "rgba(110,76,30,0.42)",
  light: "rgba(255,244,214,0.6)",
};

export function LivingBlueprint({
  project,
  projectName,
  estimateAmount,
  priceOverrides = {},
  showPrices,
  backHref,
  onBeforeLeave,
  documents,
  embed = false,
  editing = false,
  selectedId = null,
  onSelectInstance,
  onToggleEditing,
  editorPanel,
}: LivingBlueprintProps) {
  const scene = useMemo(() => buildScene(project), [project]);
  const rail = useMemo(
    () => buildRail(scene, priceOverrides),
    [scene, priceOverrides]
  );

  const [mode, setMode] = useState<"3d" | "plan">("3d");
  // Symbols draw at MATURE spread, which is what a landscape plan is for:
  // the diameter is how you catch two trees planted twelve feet apart that
  // both reach twenty. It also means a 5 gal and a 24" Box of the same tree
  // draw identically — correct, because they become the same tree. The
  // container belongs in the callout and the schedule, not in the symbol.
  //
  // The mature/at-planting toggle was removed Sep 2026; pinning everything
  // to 0.45 of mature, which is what replaced it, was neither convention.
  const [selected, setSelected] = useState<string | null>(null);

  type Cam = { az: number; el: number; dist: number; fov: number };
  // panX/panZ slide the point the camera looks at across the ground, so the
  // yard can be bigger than the screen without the view being stuck on its
  // centre. They are deliberately NOT part of saved3d: switching modes keeps
  // you over the same patch of ground, it just changes the angle on it.
  type View = Cam & {
    zoom: number;
    planT: number;
    growth: number;
    panX: number;
    panZ: number;
  };
  const camRef = useRef<{
    cur: View;
    tgt: View;
    saved3d: Cam;
  } | null>(null);

  const hoverRef = useRef<string | null>(null);

  const onSelectRef = useRef(onSelectInstance);
  useEffect(() => {
    onSelectRef.current = onSelectInstance;
  }, [onSelectInstance]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // Mirror interactive state into refs so the rAF loop never restarts.
  const stateRef = useRef({
    mode,
    selected,
    editing,
    selectedId,
  });
  useEffect(() => {
    stateRef.current = {
      mode,
      selected,
      editing,
      selectedId,
    };
  }, [mode, selected, editing, selectedId]);

  const selectSpecies = useCallback((model: string | null) => {
    setSelected((prev) => (prev === model ? null : model));
  }, []);

  useEffect(() => {
    if (!selected) return;
    rowRefs.current.get(selected)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  /* ── Canvas renderer ──────────────────────────────────────────── */
  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const K = reducedMotion ? 1 : 0.14;
    // Wide enough to read a single plant's symbol at one end and to see a
    // whole acre at the other. The old ceiling of 2.6 was the reason the
    // viewer felt stuck.
    const ZOOM_MIN = 0.3;
    const ZOOM_MAX = 10;

    const R = scene.radius;
    const [cx, cz] = scene.center;
    // The point the camera looks at stays INSIDE the design, so that however
    // far you pan and however far you zoom, there is always something under
    // the middle of the screen. Corners are still reachable — they sit near
    // the frame edge when you are centred on the bound. Zooming toward the
    // cursor obeys the same limit.
    const PAN_LIMIT = R * 0.9;
    const V3D = { az: -30, el: 30, dist: R * 2.6, fov: 40 };
    const VPLAN = { az: 0, el: 88.5, dist: R * 10.2, fov: 10 };
    // The camera lives OUTSIDE this effect. Editing a design hands down a new
    // `project`, which rebuilds `scene`, which re-runs this whole effect — and
    // a camera created in here would snap back to its opening angle on every
    // size tap. It survives across rebuilds and is only created once.
    if (!camRef.current) {
      camRef.current = {
        cur: { ...V3D, zoom: 1, planT: 0, growth: 1, panX: 0, panZ: 0 },
        tgt: { ...V3D, zoom: 1, planT: 0, growth: 1, panX: 0, panZ: 0 },
        saved3d: { ...V3D },
      };
    }
    const cam = camRef.current;
    // A camera carried over from before panning existed has no offset.
    for (const v of [cam.cur, cam.tgt]) {
      if (!Number.isFinite(v.panX)) v.panX = 0;
      if (!Number.isFinite(v.panZ)) v.panZ = 0;
    }
    const cur = cam.cur;
    const tgt = cam.tgt;
    let lastMode: "3d" | "plan" = "3d";

    let W = 0;
    let H = 0;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(wrap);

    /* camera */
    let eye = [0, 0, 0];
    let rt = [1, 0, 0];
    let up = [0, 1, 0];
    let fw = [0, 0, -1];
    let focal = 1000;
    const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a: number[], b: number[]) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const dot = (a: number[], b: number[]) =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = (a: number[]) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    };
    function updateCam() {
      const ar = (cur.az * Math.PI) / 180;
      const er = (cur.el * Math.PI) / 180;
      const target = [cx + cur.panX, 0, cz + cur.panZ];
      eye = [
        target[0] + cur.dist * Math.cos(er) * Math.sin(ar),
        cur.dist * Math.sin(er),
        target[2] + cur.dist * Math.cos(er) * Math.cos(ar),
      ];
      fw = norm(sub(target, eye));
      rt = norm(cross(fw, [0, 1, 0]));
      up = cross(rt, fw);
      focal = ((H / 2) / Math.tan(((cur.fov / 2) * Math.PI) / 180)) * cur.zoom;
    }
    const P = (x: number, y: number, z: number): [number, number, number] => {
      const d = sub([x, y, z], eye);
      const zc = Math.max(dot(d, fw), 1);
      return [
        W / 2 + (dot(d, rt) * focal) / zc,
        H / 2 - (dot(d, up) * focal) / zc,
        zc,
      ];
    };
    /** The inverse of P for the ground plane: where a screen point lands on
     *  y=0, or null when the ray misses it (at or above the horizon). This
     *  is what makes dragging feel like moving the ground rather than the
     *  camera — the spot under the cursor stays under the cursor. */
    const groundAt = (sx: number, sy: number): [number, number] | null => {
      const u = (sx - W / 2) / focal;
      const v = (sy - H / 2) / focal;
      const dy = fw[1] + rt[1] * u - up[1] * v;
      if (dy > -1e-4) return null;
      const t = -eye[1] / dy;
      if (!Number.isFinite(t) || t < 0) return null;
      return [
        eye[0] + (fw[0] + rt[0] * u - up[0] * v) * t,
        eye[2] + (fw[2] + rt[2] * u - up[2] * v) * t,
      ];
    };
    /** How many screen pixels a foot covers at a point on the ground.
     *
     *  Measured ACROSS the view, never along the world's X axis. Measuring
     *  along X was the bug behind flower heads and tree trunks that shrank
     *  from some angles and not others: orbit until X points at the camera
     *  and that offset foreshortens to nothing, so everything sized by it
     *  collapsed. The camera's right vector is horizontal and always square
     *  to the view, so a foot along it is never foreshortened — which is
     *  what "a foot, on screen, here" has to mean. */
    const ftPx = (x: number, z: number, r: number) => {
      const a = P(x, 0, z);
      const b = P(x + rt[0] * r, 0, z + rt[2] * r);
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };

    /* path helpers */
    function pathPoly(pts: [number, number][], y = 0) {
      ctx!.beginPath();
      pts.forEach(([x, z], i) => {
        const s = P(x, y, z);
        if (i) ctx!.lineTo(s[0], s[1]);
        else ctx!.moveTo(s[0], s[1]);
      });
      ctx!.closePath();
    }
    function screenBBox(pts: [number, number][]) {
      let x0 = 1e9,
        y0 = 1e9,
        x1 = -1e9,
        y1 = -1e9;
      for (const [x, z] of pts) {
        const s = P(x, 0, z);
        x0 = Math.min(x0, s[0]);
        y0 = Math.min(y0, s[1]);
        x1 = Math.max(x1, s[0]);
        y1 = Math.max(y1, s[1]);
      }
      return [x0, y0, x1, y1];
    }
    function hatch(pts: [number, number][], color: string, spacing: number) {
      ctx!.save();
      pathPoly(pts);
      ctx!.clip();
      const [x0, y0, x1, y1] = screenBBox(pts);
      const span = y1 - y0;
      ctx!.strokeStyle = color;
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      for (let x = x0 - span; x < x1; x += spacing) {
        ctx!.moveTo(x, y0);
        ctx!.lineTo(x + span, y1);
      }
      ctx!.stroke();
      ctx!.restore();
    }
    function dots(pts: [number, number][], color: string, spacing: number) {
      ctx!.save();
      pathPoly(pts);
      ctx!.clip();
      const [x0, y0, x1, y1] = screenBBox(pts);
      ctx!.fillStyle = color;
      for (let x = x0; x < x1; x += spacing)
        for (let y = y0 + ((x / spacing) % 2) * (spacing / 2); y < y1; y += spacing) {
          ctx!.beginPath();
          ctx!.arc(x, y, 1.1, 0, 7);
          ctx!.fill();
        }
      ctx!.restore();
    }
    function shrink(pts: [number, number][], f: number): [number, number][] {
      let sx = 0,
        sz = 0;
      for (const [x, z] of pts) {
        sx += x;
        sz += z;
      }
      sx /= pts.length;
      sz /= pts.length;
      return pts.map(([x, z]) => [sx + (x - sx) * f, sz + (z - sz) * f]);
    }
    function centroid(pts: [number, number][]): [number, number] {
      let sx = 0,
        sz = 0;
      for (const [x, z] of pts) {
        sx += x;
        sz += z;
      }
      return [sx / pts.length, sz / pts.length];
    }
    function circle3D(x: number, y: number, z: number, r: number, n = 22) {
      ctx!.beginPath();
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const s = P(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
        if (k) ctx!.lineTo(s[0], s[1]);
        else ctx!.moveTo(s[0], s[1]);
      }
      ctx!.closePath();
    }

    /* per-frame screen cache for hit testing */
    const hits: { model: string; id: string; sx: number; sy: number; r: number }[] = [];

    function drawExtruded(pts: [number, number][], hFt: number, label: string | null, t: number) {
      const quads = pts
        .map((p, i) => {
          const q = pts[(i + 1) % pts.length];
          const mid = P((p[0] + q[0]) / 2, hFt / 2, (p[1] + q[1]) / 2);
          return { p, q, depth: mid[2] };
        })
        .sort((a, b) => b.depth - a.depth);
      for (const { p, q } of quads) {
        const a = P(p[0], 0, p[1]);
        const b = P(q[0], 0, q[1]);
        const c = P(q[0], hFt, q[1]);
        const d = P(p[0], hFt, p[1]);
        ctx!.beginPath();
        ctx!.moveTo(a[0], a[1]);
        ctx!.lineTo(b[0], b[1]);
        ctx!.lineTo(c[0], c[1]);
        ctx!.lineTo(d[0], d[1]);
        ctx!.closePath();
        ctx!.fillStyle = "#ddd0b2";
        ctx!.fill();
        ctx!.strokeStyle = verde(0.45);
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }
      pathPoly(pts, hFt);
      ctx!.fillStyle = "#e6dbc0";
      ctx!.fill();
      ctx!.strokeStyle = verde(0.5);
      ctx!.lineWidth = 1.1;
      ctx!.stroke();
      if (label) {
        const [gx, gz] = centroid(pts);
        const s = P(gx, hFt, gz);
        ctx!.font = "500 10px ui-monospace, Menlo, monospace";
        ctx!.textAlign = "center";
        ctx!.fillStyle = ink(0.45 + 0.2 * t);
        ctx!.fillText(label.toUpperCase(), s[0], s[1]);
        ctx!.textAlign = "left";
      }
    }

    /** Agave americana, from the scan.
     *
     *  Not the generic rosette: that is nine single strokes, and a stroke has
     *  no width, so a yard of them reads as tufts of grass. An agave's leaves
     *  are BROAD — a hand's width at the base, tapering to one hard terminal
     *  spine — and that width is most of what identifies the plant.
     *
     *  Leaves sit on the golden angle, which is how a rosette actually packs
     *  itself, and age outward: the first ones out are the oldest, flung
     *  nearly flat and sagging to the ground, while the youngest stand almost
     *  upright in a tight spike at the middle. That spread — low skirt, hard
     *  vertical core — is the silhouette in the photograph.
     */
    /** A trunk, rather than a line.
     *
     *  Every tree stood on a single stroke of constant width, which reads as
     *  a pole holding up a canopy. A real one is thick at the ground, thins
     *  as it rises, and forks low — on a mesquite low enough that the fork
     *  is most of what you see of the wood. Drawn as tapered quads so the
     *  width can actually change along the limb, which a stroke cannot do.
     */
    /** A barrel cactus, from the scan: a squat ribbed dome under a spiny
     *  skin, with a woolly crown. It was a plain ellipse, which is the right
     *  silhouette and nothing else — none of the ribbing that makes a barrel
     *  a barrel, and no clue which way is up. */

    // White Dawn, grown once per plant and kept, as the shrubs are.
    type WhiteDawnSprig = {
      c: [number, number, number];
      /** leaf corners as offsets from c, xyz; WHITE_DAWN_LEAF.length each */
      leaves: Float32Array;
      /** the same leaves as kites, WHITE_DAWN_KITE.length each */
      kites: Float32Array;
      inner: boolean;
      /** its step on the light ramp, 0 shade to WD_LEVELS - 1 lit */
      tone: number;
    };
    type WhiteDawnPlant = {
      /** the runners, each a path from the crown */
      runners: [number, number, number][][];
      sprigs: WhiteDawnSprig[];
      /** flower heads: centre and radius, ft */
      flowers: [number, number, number, number][];
    };
    // A lantana leaf: a broad oval to a blunt point. Narrower, they read as
    // fern.
    const WHITE_DAWN_LEAF: [number, number][] = [[0, 0], [0.22, 0.48], [0.62, 0.44], [1, 0], [0.62, -0.44], [0.22, -0.48]];
    // The leaf as a kite of the same area, for leaves a few pixels long:
    // the oval can't be told from it at that size, and the plant's
    // thousands of corners are most of its cost.
    const WHITE_DAWN_KITE: [number, number][] = [[0, 0], [0.4, 0.64], [1, 0], [0.4, -0.64]];
    // Leaf tones in steps, made once, so a fill's colour is only set when
    // the step changes: the leaves', then the shaded heart's. A fill per
    // cluster: sharing fills — a run of one tone, or a band of depth and a
    // step of tone at once — was slower, the long paths costing more to
    // fill than the fills they save.
    const WD_LEVELS = 8;
    const WD_TONES = [WHITE_DAWN_COLOURS, WHITE_DAWN_GOLD].map((pal) => {
      const ramp = (inner: boolean) =>
        Array.from({ length: WD_LEVELS }, (_, k) => {
          const t = 0.25 + (0.75 * k) / (WD_LEVELS - 1);
          const col = pal.leafShade.map((v, i) => v + (pal.leafLit[i] - v) * t);
          const c = inner ? pal.inner.map((v, i) => v + (col[i] - v) * 0.45) : col;
          return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        });
      return [...ramp(false), ...ramp(true)];
    });
    const whiteDawnGrown = new Map<string, WhiteDawnPlant>();
    // Scratch, reused plant to plant.
    let wdDepth = new Float32Array(1024);
    let wdOrder = new Int32Array(1024);

    function growWhiteDawn(x: number, z: number, h: number, rw: number, rot: number, seed: string): WhiteDawnPlant {
      const rng = rngFor("white-dawn:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const crs = (a: V3, b: V3): V3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      // A mat, lit from above: leaves high on an arch catch the light, the
      // ones down in it don't. Mottled a step either way, as the scan is.
      const toneAt = (c: V3, n: V3) => {
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        const shade = (0.4 + 0.6 * lit) * (0.62 + 0.38 * Math.min(1, c[1] / (h * 0.5))) * (0.9 + 0.2 * rng());
        return Math.max(0, Math.min(WD_LEVELS - 1, Math.round(((shade - 0.25) / 0.75) * (WD_LEVELS - 1))));
      };

      const runners: V3[][] = [];
      const sprigs: WhiteDawnSprig[] = [];
      const flowers: [number, number, number, number][] = [];
      const L = rw * 0.085;
      // A cluster of four to six leaves round a point on a runner, held near
      // flat — a groundcover turns its leaves to the sky.
      const cluster = (c: V3, dir: V3, len: number, inner: boolean) => {
        const side = nrm(crs([0, 1, 0], dir));
        const pts: number[] = [];
        const kts: number[] = [];
        const put = (d: V3, l: number) => {
          const p = nrm(crs([0, 1, 0], d));
          for (const [f, q] of WHITE_DAWN_LEAF) {
            for (let i = 0; i < 3; i++) pts.push(d[i] * l * f + p[i] * l * 0.62 * q);
          }
          for (const [f, q] of WHITE_DAWN_KITE) {
            for (let i = 0; i < 3; i++) kts.push(d[i] * l * f + p[i] * l * 0.62 * q);
          }
        };
        const spin = rng() * Math.PI;
        const k = 4 + Math.floor(rng() * 3);
        for (let j = 0; j < k; j++) {
          const ang = spin + (j / k) * Math.PI * 2 + (rng() - 0.5) * 0.9;
          const l = 0.75 + 0.3 * rng();
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const d = nrm([dir[0] * ca + side[0] * sa, 0.12 + (rng() - 0.3) * 0.5, dir[2] * ca + side[2] * sa]);
          put(d, len * l);
        }
        const n = nrm([(c[0] - x) / rw, 1.6, (c[2] - z) / rw]);
        sprigs.push({ c, leaves: new Float32Array(pts), kites: new Float32Array(kts), inner, tone: toneAt(c, n) });
      };
      // A flower head on a short stalk over the leaves.
      const bloom = (c: V3) => {
        flowers.push([c[0], c[1] + h * 0.04, c[2], rw * (0.032 + 0.012 * rng())]);
      };

      // Runners: wiry stems out of a small crown, arching up and over and
      // trailing out low across the ground, their tips lifting — a few
      // standing right up at the edge, as the scan's do. Each forks once
      // or twice. Out to an oval a fifth narrower across the plant's yaw
      // than along it, as the model is.
      const walk = (p0: V3, p1: V3, p2: V3, p3: V3, flowerAtTip: boolean) => {
        const at = (t: number): V3 => {
          const u = 1 - t;
          return [0, 1, 2].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]) as V3;
        };
        const path: V3[] = [];
        for (let i = 0; i <= 10; i++) path.push(at(i / 10));
        runners.push(path);
        let len = 0;
        for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
        const n = Math.max(3, Math.round(len / (rw * 0.08)));
        for (let i = 0; i < n; i++) {
          const t = Math.min(1, 0.12 + (0.88 * (i + 0.2 + 0.6 * rng())) / n);
          const c = at(t);
          const c2 = at(Math.min(1, t + 0.02));
          const dir = nrm([c2[0] - c[0], 0, c2[2] - c[2]]);
          cluster(c, dir, L * (t > 0.9 ? 0.75 : 1), false);
          if (rng() < 0.03) bloom(c);
        }
        if (flowerAtTip && rng() < 0.45) bloom(at(1));
        return at;
      };
      const NR = 22;
      for (let k = 0; k < NR; k++) {
        const a = rot + k * 2.399963 + (rng() - 0.5) * 0.5;
        const edge = rw * (1 - 0.21 * Math.sin(a - rot) ** 2);
        const R = edge * (0.5 + 0.5 * Math.sqrt(rng()));
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const wob = (rng() - 0.5) * 0.24 * R;
        const lift = rng() < 0.12;
        const pt = (r: number, y: number, side: number): V3 => [x + ca * r - sa * side, y, z + sa * r + ca * side];
        const at = walk(
          pt(rw * 0.04, h * 0.12, 0),
          pt(R * 0.3, h * (0.42 + 0.16 * rng()), wob * 0.5),
          pt(R * 0.7, h * (lift ? 0.3 + 0.12 * rng() : 0.18 + 0.12 * rng()), wob),
          pt(R * (lift ? 0.9 : 1), h * (lift ? 0.55 + 0.25 * rng() : 0.1 + 0.12 * rng()), wob * 1.3 + (lift ? (rng() - 0.5) * R * 0.3 : 0)),
          true,
        );
        // Side runners forking off partway out.
        const forks = 1 + (rng() < 0.5 ? 1 : 0);
        for (let f = 0; f < forks; f++) {
          const t = 0.3 + 0.3 * rng();
          const p0 = at(t);
          const b = a + (rng() < 0.5 ? 1 : -1) * (0.45 + 0.35 * rng());
          const rr = R * (0.3 + 0.25 * rng());
          const cb = Math.cos(b);
          const sb = Math.sin(b);
          walk(
            p0,
            [p0[0] + cb * rr * 0.35, p0[1] + h * 0.06, p0[2] + sb * rr * 0.35],
            [p0[0] + cb * rr * 0.75, h * (0.14 + 0.1 * rng()), p0[2] + sb * rr * 0.75],
            [p0[0] + cb * rr, h * (0.08 + 0.12 * rng()), p0[2] + sb * rr],
            true,
          );
        }
      }
      // The heart of the mat, where the runners crowd out of the crown:
      // clusters in shade, fill only, so it reads as a mat there and not a
      // tangle of wire.
      for (let i = 0; i < 70; i++) {
        const th = rng() * Math.PI * 2;
        const r = rw * 0.5 * Math.sqrt(rng()) * (1 - 0.21 * Math.sin(th - rot) ** 2);
        const c: V3 = [x + Math.cos(th) * r, h * (0.08 + 0.26 * rng()) * (1 - (0.5 * r) / rw), z + Math.sin(th) * r];
        cluster(c, [Math.cos(th + 1.3), 0, Math.sin(th + 1.3)], L * 1.15, true);
      }
      // The heart first, a step of tone at a time; the rest as grown.
      sprigs.sort((a, b) => (a.inner === b.inner ? (a.inner ? a.tone - b.tone : 0) : a.inner ? -1 : 1));
      return { runners, sprigs, flowers };
    }

    /** White Dawn lantana, after the app's model.
     *
     *  A trailing groundcover, low and open — nothing like a mound: wiry
     *  runners out of a small crown, arching up and over and trailing out
     *  across the ground, forking as they go, with their tips lifting and
     *  here and there one standing right up at the edge. Small mid-dark
     *  leaves in clusters all along them, the soil showing between, and
     *  white posies with a yellow eye scattered over it, mostly at the
     *  tips. An oval, a fifth narrower across than along, as the scan is.
     *
     *  Drawn as the runners, then the shaded heart of the mat, then every
     *  leaf cluster and flower far to near, each cluster lit by where it
     *  sits; all through one local map at the crown. Grown once and cached.
     */
    function drawWhiteDawnBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = whiteDawnGrown.get(key);
      if (!grown) {
        if (whiteDawnGrown.size > 400) whiteDawnGrown.clear(); // growth and edits mint new keys
        grown = growWhiteDawn(x, z, h, rw, rot, seed);
        whiteDawnGrown.set(key, grown);
      }
      const pal = sel ? WHITE_DAWN_GOLD : WHITE_DAWN_COLOURS;

      // The local map at the crown: screen x, y and depth per foot.
      const cy = h * 0.2;
      const q = P(x, cy, z);
      const qx = P(x + 1, cy, z);
      const qy = P(x, cy + 1, z);
      const qz = P(x, cy, z + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const sx = (px: number, py: number, pz: number) => q[0] + J[0] * (px - x) + J[1] * (py - cy) + J[2] * (pz - z);
      const sy = (px: number, py: number, pz: number) => q[1] + J[3] * (px - x) + J[4] * (py - cy) + J[5] * (pz - z);
      const depth = (px: number, py: number, pz: number) => q[2] + J[6] * (px - x) + J[7] * (py - cy) + J[8] * (pz - z);

      ctx!.strokeStyle = pal.stem;
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      ctx!.lineWidth = Math.max(ftPx(x, z, rw * 0.012), lw * 0.4);
      ctx!.beginPath();
      for (const path of grown.runners) {
        for (let i = 0; i < path.length; i++) {
          const [px, py, pz] = path[i];
          if (i) ctx!.lineTo(sx(px, py, pz), sy(px, py, pz));
          else ctx!.moveTo(sx(px, py, pz), sy(px, py, pz));
        }
      }
      ctx!.stroke();
      ctx!.lineCap = "butt";

      const tones = WD_TONES[sel ? 1 : 0];
      // Kites while the leaves are under six pixels long.
      const kite = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5])) * rw * 0.085 < 6;
      const n = kite ? WHITE_DAWN_KITE.length : WHITE_DAWN_LEAF.length;
      const leafPath = (sp: WhiteDawnSprig) => {
        const [cx, cy2, cz] = sp.c;
        const ox = sx(cx, cy2, cz);
        const oy = sy(cx, cy2, cz);
        const pts = kite ? sp.kites : sp.leaves;
        for (let o = 0; o < pts.length; o += n * 3) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const px = ox + J[0] * pts[i] + J[1] * pts[i + 1] + J[2] * pts[i + 2];
            const py = oy + J[3] * pts[i] + J[4] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(px, py);
            else ctx!.moveTo(px, py);
          }
          ctx!.closePath();
        }
      };
      const { sprigs, flowers } = grown;
      const m = sprigs.length;
      const all = m + flowers.length;
      if (wdDepth.length < all) {
        wdDepth = new Float32Array(all * 2);
        wdOrder = new Int32Array(all * 2);
      }
      let fill = "";
      const paint = (col: string) => {
        if (col !== fill) ctx!.fillStyle = fill = col;
        ctx!.fill();
      };

      // The shaded heart first.
      let m0 = 0;
      for (; m0 < m && sprigs[m0].inner; m0++) {
        ctx!.beginPath();
        leafPath(sprigs[m0]);
        paint(tones[WD_LEVELS + sprigs[m0].tone]);
      }

      // The rest far to near, the flowers in with the leaves — a little
      // nearer than they stand, as they sit up over them.
      let count = 0;
      for (let i = m0; i < m; i++) {
        const sp = sprigs[i];
        wdDepth[i] = depth(sp.c[0], sp.c[1], sp.c[2]);
        wdOrder[count++] = i;
      }
      for (let i = 0; i < flowers.length; i++) {
        const f = flowers[i];
        wdDepth[m + i] = depth(f[0], f[1], f[2]) - 0.05;
        wdOrder[count++] = m + i;
      }
      const order = wdOrder.subarray(0, count).sort((a, b) => wdDepth[b] - wdDepth[a]);
      // Pixels a foot across the view: the longer of the two ground axes on
      // screen, which holds from overhead too (a foot up shrinks to nothing).
      const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]));
      for (const i of order) {
        if (i < m) {
          ctx!.beginPath();
          leafPath(sprigs[i]);
          paint(tones[sprigs[i].tone]);
          continue;
        }
        // A flat posy: the disc, and close up its ring of florets round a
        // yellow eye.
        // Far off, never under a pixel and a bit across: the white is
        // what tells this lantana from the other two.
        const [fx, fy, fz, r0] = flowers[i - m];
        const r = Math.max(r0, 1.5 / footPx);
        const ox = sx(fx, fy, fz);
        const oy = sy(fx, fy, fz);
        const ax = J[0] * r;
        const ay = J[3] * r;
        const bx = J[2] * r;
        const by = J[5] * r;
        ctx!.beginPath();
        for (let k = 0; k < 10; k++) {
          const t = (k / 10) * Math.PI * 2;
          const c = Math.cos(t);
          const s2 = Math.sin(t);
          if (k) ctx!.lineTo(ox + ax * c + bx * s2, oy + ay * c + by * s2);
          else ctx!.moveTo(ox + ax * c + bx * s2, oy + ay * c + by * s2);
        }
        ctx!.closePath();
        paint(pal.flower);
        const px = footPx * r;
        if (px > 5) {
          ctx!.beginPath();
          for (let k = 0; k < 6; k++) {
            const t = (k / 6) * Math.PI * 2 + fx;
            const cx = ox + (ax * Math.cos(t) + bx * Math.sin(t)) * 0.55;
            const cy3 = oy + (ay * Math.cos(t) + by * Math.sin(t)) * 0.55;
            ctx!.moveTo(cx + px * 0.36, cy3);
            ctx!.arc(cx, cy3, px * 0.36, 0, Math.PI * 2);
          }
          paint(pal.floret);
        }
        if (px > 2.5) {
          ctx!.beginPath();
          ctx!.arc(ox, oy, Math.max(0.8, px * 0.22), 0, Math.PI * 2);
          paint(pal.eye);
        }
      }
      ctx!.lineJoin = "miter";
      ctx!.lineWidth = lw;
    }

    type PurpleSprig = {
      c: [number, number, number];
      /** the mound's outward normal there, to pass over the far side */
      n: [number, number, number];
      /** leaf corners as offsets from c, xyz; PURPLE_LEAF.length each */
      leaves: Float32Array;
      /** the same leaves as kites, PURPLE_KITE.length each */
      kites: Float32Array;
      inner: boolean;
      /** its step on the light ramp, 0 shade to PL_LEVELS - 1 lit */
      tone: number;
    };
    type PurplePlant = {
      sprigs: PurpleSprig[];
      /** flower heads, 8 numbers each: centre, radius (ft), outward
       *  normal, step on the flower ramp */
      flowers: Float32Array;
      /** the heart of the mound, set in from the leaves, hulled for the
       *  dark core */
      core: [number, number, number][];
    };
    // A lantana leaf, broad and ovate.
    const PURPLE_LEAF: [number, number][] = [[0, 0], [0.2, 0.5], [0.6, 0.5], [1, 0], [0.6, -0.5], [0.2, -0.5]];
    // The leaf as a kite of the same area, for leaves a few pixels long.
    const PURPLE_KITE: [number, number][] = [[0, 0], [0.4, 0.7], [1, 0], [0.4, -0.7]];
    const PL_LEVELS = 8;
    const PL_FLOWER_LEVELS = 4;
    // Tones made once, so a fill's colour is only set when the step changes.
    const PL_TONES = [PURPLE_LANTANA_COLOURS, PURPLE_LANTANA_GOLD].map((pal) => {
      const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
      const leaf = Array.from({ length: PL_LEVELS }, (_, k) => mix(pal.leafShade, pal.leafLit, 0.2 + (0.8 * k) / (PL_LEVELS - 1)));
      const step = (k: number) => k / (PL_FLOWER_LEVELS - 1);
      return {
        leaf: leaf.map(rgb),
        inner: leaf.map((c) => rgb(mix(pal.inner, c, 0.4))),
        flower: Array.from({ length: PL_FLOWER_LEVELS }, (_, k) => rgb(mix(pal.flowerShade, pal.flower, step(k)))),
        flowerLit: Array.from({ length: PL_FLOWER_LEVELS }, (_, k) => rgb(mix(pal.flower, pal.flowerLit, 0.15 + 0.5 * step(k)))),
        floret: Array.from({ length: PL_FLOWER_LEVELS }, (_, k) => rgb(mix(mix(pal.flowerShade, pal.flower, step(k)), pal.flowerLit, 0.35))),
      };
    });
    const purpleGrown = new Map<string, PurplePlant>();
    // Scratch, reused plant to plant.
    let plDepth = new Float32Array(2048);
    let plOrder = new Int32Array(2048);

    function growPurpleLantana(x: number, z: number, h: number, rw: number, rot: number, seed: string): PurplePlant {
      const rng = rngFor("purple-lantana:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const crs = (a: V3, b: V3): V3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];

      // The outline: an oval a quarter narrower across the plant's yaw than
      // along it, as the scan is, thrown out in low arms with notches
      // between; shoots trail out past it to the plant's full spread.
      const ph2 = rng() * Math.PI * 2;
      const ph3 = rng() * Math.PI * 2;
      const ph5 = rng() * Math.PI * 2;
      const oval = (th: number) => rw * (1 - 0.24 * Math.sin(th - rot) ** 2);
      const edge = (th: number) =>
        oval(th) * (0.86 + 0.06 * Math.sin(2 * th + ph2) + 0.05 * Math.sin(3 * th + ph3) + 0.03 * Math.sin(5 * th + ph5));
      // The mound: a low flat-topped cushion, held up nearly to its edge as
      // the scan is, with lumps and pockets all over it — not a smooth bun.
      // A sprinkle of lumps, not a few big ones: big ones stack into a peak.
      const lumps = Array.from({ length: 11 }, (_, i) => {
        const th = i * 2.399963 + rng();
        const r = rw * 0.75 * Math.sqrt((i + 0.5) / 11);
        return [x + Math.cos(th) * r, z + Math.sin(th) * r, (rng() < 0.3 ? -0.5 : 1) * (0.12 + 0.14 * rng()), rw * (0.12 + 0.08 * rng())];
      });
      // Flat-topped in the middle and falling away with the distance out,
      // so the arms run lower than the body; rounded off at the outline.
      const raw = (px: number, pz: number) => {
        const r = Math.hypot(px - x, pz - z);
        const th = Math.atan2(pz - z, px - x);
        const rho = r / edge(th);
        if (rho >= 1) return 0;
        const out = Math.min(1, r / oval(th));
        let lump = 0;
        for (const [lx, lz, a, sg] of lumps) lump += a * Math.exp(-((px - lx) ** 2 + (pz - lz) ** 2) / (sg * sg));
        return (0.8 * (0.15 + 0.85 * (1 - out ** 2.5) ** 0.8) + lump * (1 - rho ** 4)) * (1 - rho ** 6) ** 0.5;
      };
      // Scaled so its highest lump, with the leaves standing on it, is the
      // plant's height.
      let top = 0;
      for (let i = 0; i < 400; i++) {
        const r = Math.sqrt((i + 0.5) / 400) * rw;
        top = Math.max(top, raw(x + Math.cos(i * 2.399963) * r, z + Math.sin(i * 2.399963) * r));
      }
      const S = (px: number, pz: number) => (raw(px, pz) * h * 0.88) / top;
      const e = rw * 0.03;
      const normalAt = (px: number, pz: number): V3 =>
        nrm([(S(px - e, pz) - S(px + e, pz)) / (2 * e), 1, (S(px, pz - e) - S(px, pz + e)) / (2 * e)]);
      // Down in the folds between lumps is darker.
      const foldAt = (px: number, pz: number) => {
        const f = rw * 0.07;
        const dip = (S(px + f, pz) + S(px - f, pz) + S(px, pz + f) + S(px, pz - f)) / 4 - S(px, pz);
        return 1 - Math.min(0.45, Math.max(0, dip / (h * 0.04)) * 0.45);
      };
      // Lit from above, darker low down, mottled a step either way.
      const toneAt = (c: V3, n: V3, dark: number) => {
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        const shade = (0.25 + 0.75 * lit) * (0.5 + 0.5 * Math.min(1, c[1] / (h * 0.7))) * dark * (0.72 + 0.5 * rng());
        const step = Math.round(((shade - 0.2) / 0.8) * (PL_LEVELS - 1)) + (rng() < 0.15 ? 2 : 0);
        return Math.max(0, Math.min(PL_LEVELS - 1, step));
      };

      const sprigs: PurpleSprig[] = [];
      const L = rw * 0.06;
      // A cluster of three to five leaves round a shoot tip, lying in the
      // mound's skin and lifting a little off it.
      const cluster = (c: V3, n: V3, len: number, inner: boolean, dark: number) => {
        const t1 = nrm(crs(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
        const t2 = crs(n, t1);
        const pts: number[] = [];
        const kts: number[] = [];
        const spin = rng() * Math.PI * 2;
        const m = 3 + Math.floor(rng() * 3);
        for (let j = 0; j < m; j++) {
          const a = spin + (j / m) * Math.PI * 2 + (rng() - 0.5) * 0.8;
          const l = len * (0.8 + 0.4 * rng());
          const lift = 0.15 + 0.35 * rng();
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const d = nrm([t1[0] * ca + t2[0] * sa + n[0] * lift, t1[1] * ca + t2[1] * sa + n[1] * lift, t1[2] * ca + t2[2] * sa + n[2] * lift]);
          const p = nrm(crs(n, d));
          for (const [f, q] of PURPLE_LEAF) for (let i = 0; i < 3; i++) pts.push(d[i] * l * f + p[i] * l * 0.7 * q);
          for (const [f, q] of PURPLE_KITE) for (let i = 0; i < 3; i++) kts.push(d[i] * l * f + p[i] * l * 0.7 * q);
        }
        sprigs.push({ c, n, leaves: new Float32Array(pts), kites: new Float32Array(kts), inner, tone: toneAt(c, n, dark) });
      };
      const flowers: number[] = [];
      // A flower head sitting up off the leaves.
      const bloom = (c: V3, n: V3) => {
        const r = rw * (0.022 + 0.02 * rng());
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        const shade = (0.35 + 0.65 * lit) * (0.7 + 0.3 * Math.min(1, c[1] / (h * 0.6)));
        const tone = Math.max(0, Math.min(PL_FLOWER_LEVELS - 1, Math.round(shade * (PL_FLOWER_LEVELS - 1))));
        flowers.push(c[0] + n[0] * r * 0.6, c[1] + n[1] * r * 0.6, c[2] + n[2] * r * 0.6, r, n[0], n[1], n[2], tone);
      };
      // A point on the mound's top, or on its side down to the ground.
      const onTop = (th: number, rho: number): [V3, V3, number] => {
        const r = rho * edge(th);
        const px = x + Math.cos(th) * r;
        const pz = z + Math.sin(th) * r;
        return [[px, S(px, pz), pz], normalAt(px, pz), foldAt(px, pz)];
      };
      const onSide = (th: number): [V3, V3] => {
        const r = (0.86 + (rng() < 0.2 ? 0.25 : 0.12) * rng()) * edge(th);
        const px = x + Math.cos(th) * r;
        const pz = z + Math.sin(th) * r;
        return [[px, S(px, pz) * (0.05 + 0.9 * rng()), pz], nrm([Math.cos(th), 0.55, Math.sin(th)])];
      };

      // The shaded layer under the leaves, so a gap shows leaves in shadow
      // before it shows the core.
      for (let i = 0; i < 150; i++) {
        const [c, n] = onTop(i * 2.399963, 0.95 * Math.sqrt((i + 0.5) / 150));
        cluster([c[0], c[1] - h * 0.09, c[2]], n, L * 1.1, true, 0.8);
      }
      // The skin, evenly over the top on a spiral, then round the sides.
      const NT = 640;
      for (let i = 0; i < NT; i++) {
        const [c, n, fold] = onTop(i * 2.399963 + (rng() - 0.5) * 0.2, Math.min(0.97, Math.sqrt((i + 0.5) / NT) + (rng() - 0.5) * 0.03));
        const proud = rng() < 0.12 ? h * (0.04 + 0.06 * rng()) : h * 0.04 * (rng() - 0.5);
        cluster([c[0] + n[0] * proud, c[1] + n[1] * proud, c[2] + n[2] * proud], n, L, false, fold);
      }
      for (let i = 0; i < 180; i++) {
        const [c, n] = onSide(i * 2.399963 + rng() * 0.3);
        cluster(c, n, L, false, 1);
      }
      // Shoots trailing out past the mound, low, to break its edge.
      for (let i = 0; i < 22; i++) {
        const th = i * 2.399963 + rng() * 0.5;
        const ed = edge(th);
        const out = Math.min(rw * (1 - 0.24 * Math.sin(th - rot) ** 2), ed * (1.08 + 0.16 * rng())) / ed;
        const side = (rng() - 0.5) * 0.5;
        const y0 = S(x + Math.cos(th) * ed * 0.75, z + Math.sin(th) * ed * 0.75) * (0.6 + 0.4 * rng());
        const n = nrm([Math.cos(th), 1, Math.sin(th)]);
        let c: V3 = [x, 0, z];
        for (let k = 1; k <= 5; k++) {
          const f = (0.78 + ((out - 0.78) * k) / 5) * ed;
          const a = th + side * (k / 5);
          c = [x + Math.cos(a) * f, Math.max(h * 0.03, y0 * (1 - k / 5.5)), z + Math.sin(a) * f];
          cluster(c, n, L * 0.9, false, 1);
        }
        if (rng() < 0.4) bloom(c, n);
      }
      // Flowers all over it, the sides as well as the top.
      for (let i = 0; i < 130; i++) {
        const th = rng() * Math.PI * 2;
        if (rng() < 0.3) {
          const [c, n] = onSide(th);
          bloom(c, n);
        } else {
          const [c, n] = onTop(th, 0.95 * Math.sqrt(rng()));
          bloom(c, n);
        }
      }
      // The heart, set in from the skin.
      const core: V3[] = [];
      for (let i = 0; i < 16; i++) {
        const th = (i / 16) * Math.PI * 2;
        for (const rho of [0.25, 0.5, 0.72]) {
          const [c] = onTop(th, rho);
          core.push([c[0], c[1] * 0.85 - h * 0.04, c[2]]);
        }
        const r = 0.72 * edge(th);
        core.push([x + Math.cos(th) * r, 0, z + Math.sin(th) * r]);
      }
      // The shaded layer first, a step of tone at a time; the rest as grown.
      sprigs.sort((a, b) => (a.inner === b.inner ? (a.inner ? a.tone - b.tone : 0) : a.inner ? -1 : 1));
      return { sprigs, flowers: new Float32Array(flowers), core };
    }

    /** Purple lantana, after the app's model.
     *
     *  A dense groundcover mound, low and broad and lumpy — an oval a
     *  quarter narrower across than along, as the scan is — made of small
     *  olive leaves in clusters, down in shadow between the lumps, with a
     *  few shoots trailing out past its edge. Lavender flower heads all
     *  over it, the sides as well as the top: close up, a ring of florets
     *  each with a pale eye.
     *
     *  Drawn as a dark core, then a shaded layer of leaves, then the skin's
     *  leaf clusters and the flowers far to near, the far side passed over;
     *  all through one local map at the mound. Grown once and cached.
     */
    function drawPurpleLantanaBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = purpleGrown.get(key);
      if (!grown) {
        if (purpleGrown.size > 400) purpleGrown.clear(); // growth and edits mint new keys
        grown = growPurpleLantana(x, z, h, rw, rot, seed);
        purpleGrown.set(key, grown);
      }
      const pal = sel ? PURPLE_LANTANA_GOLD : PURPLE_LANTANA_COLOURS;
      const tones = PL_TONES[sel ? 1 : 0];

      // The local map at the mound: screen x, y and depth per foot.
      const cy = h * 0.4;
      const q = P(x, cy, z);
      const qx = P(x + 1, cy, z);
      const qy = P(x, cy + 1, z);
      const qz = P(x, cy, z + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const sx = (px: number, py: number, pz: number) => q[0] + J[0] * (px - x) + J[1] * (py - cy) + J[2] * (pz - z);
      const sy = (px: number, py: number, pz: number) => q[1] + J[3] * (px - x) + J[4] * (py - cy) + J[5] * (pz - z);
      const depth = (px: number, py: number, pz: number) => q[2] + J[6] * (px - x) + J[7] * (py - cy) + J[8] * (pz - z);
      const facing = (c: ArrayLike<number>, n: ArrayLike<number>) =>
        n[0] * (eye[0] - c[0]) + n[1] * (eye[1] - c[1]) + n[2] * (eye[2] - c[2]) >= 0;

      const hull = convexHull(grown.core.map((v): [number, number] => [sx(v[0], v[1], v[2]), sy(v[0], v[1], v[2])]));
      ctx!.beginPath();
      for (let i = 0; i < hull.length; i++) {
        if (i) ctx!.lineTo(hull[i][0], hull[i][1]);
        else ctx!.moveTo(hull[i][0], hull[i][1]);
      }
      ctx!.fillStyle = pal.core;
      ctx!.fill();

      // Kites while the leaves are under six pixels long.
      const kite = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5])) * rw * 0.06 < 6;
      const n = kite ? PURPLE_KITE.length : PURPLE_LEAF.length;
      const leafPath = (sp: PurpleSprig) => {
        const [cx, cy2, cz] = sp.c;
        const ox = sx(cx, cy2, cz);
        const oy = sy(cx, cy2, cz);
        const pts = kite ? sp.kites : sp.leaves;
        for (let o = 0; o < pts.length; o += n * 3) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const px = ox + J[0] * pts[i] + J[1] * pts[i + 1] + J[2] * pts[i + 2];
            const py = oy + J[3] * pts[i] + J[4] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(px, py);
            else ctx!.moveTo(px, py);
          }
          ctx!.closePath();
        }
      };
      const { sprigs, flowers } = grown;
      const m = sprigs.length;
      const nf = flowers.length / 8;
      if (plDepth.length < m + nf) {
        plDepth = new Float32Array((m + nf) * 2);
        plOrder = new Int32Array((m + nf) * 2);
      }
      let fill = "";
      const paint = (col: string) => {
        if (col !== fill) ctx!.fillStyle = fill = col;
        ctx!.fill();
      };

      // The shaded layer.
      let m0 = 0;
      for (; m0 < m && sprigs[m0].inner; m0++) {
        const sp = sprigs[m0];
        if (!facing(sp.c, sp.n)) continue;
        ctx!.beginPath();
        leafPath(sp);
        paint(tones.inner[sp.tone]);
      }

      // The skin and the flowers far to near, the flowers a little nearer
      // than they stand, as they sit up over the leaves.
      let count = 0;
      for (let i = m0; i < m; i++) {
        const sp = sprigs[i];
        if (!facing(sp.c, sp.n)) continue;
        plDepth[i] = depth(sp.c[0], sp.c[1], sp.c[2]);
        plOrder[count++] = i;
      }
      for (let i = 0; i < nf; i++) {
        const f = flowers.subarray(i * 8, i * 8 + 8);
        if (!facing(f, f.subarray(4))) continue;
        plDepth[m + i] = depth(f[0], f[1], f[2]) - 0.05;
        plOrder[count++] = m + i;
      }
      const order = plOrder.subarray(0, count).sort((a, b) => plDepth[b] - plDepth[a]);
      // Pixels a foot across the view: the longer of the two ground axes on
      // screen, which holds from overhead too (a foot up shrinks to nothing).
      const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]));
      for (const i of order) {
        if (i < m) {
          ctx!.beginPath();
          leafPath(sprigs[i]);
          paint(tones.leaf[sprigs[i].tone]);
          continue;
        }
        // A ball of florets: the head, lit on its upper side, and close up
        // its ring of florets each with a pale eye.
        const o = (i - m) * 8;
        const ox = sx(flowers[o], flowers[o + 1], flowers[o + 2]);
        const oy = sy(flowers[o], flowers[o + 1], flowers[o + 2]);
        // Far off, a head is a fleck of its lit colour, never under a pixel
        // and a bit across: the purple is what tells this lantana from the
        // other two.
        const pr = Math.max(1.3, flowers[o + 3] * footPx);
        const t = flowers[o + 7];
        ctx!.beginPath();
        ctx!.arc(ox, oy, pr, 0, Math.PI * 2);
        paint(pr < 2 ? tones.flowerLit[t] : tones.flower[t]);
        if (pr > 7) {
          ctx!.beginPath();
          for (let k = 0; k < 7; k++) {
            const a = (k / 6) * Math.PI * 2 + flowers[o];
            const fx = k < 6 ? ox + Math.cos(a) * pr * 0.52 : ox;
            const fy = k < 6 ? oy + Math.sin(a) * pr * 0.46 : oy;
            ctx!.moveTo(fx + pr * 0.32, fy);
            ctx!.arc(fx, fy, pr * 0.32, 0, Math.PI * 2);
          }
          paint(tones.floret[t]);
          ctx!.beginPath();
          for (let k = 0; k < 7; k++) {
            const a = (k / 6) * Math.PI * 2 + flowers[o];
            const fx = k < 6 ? ox + Math.cos(a) * pr * 0.52 : ox;
            const fy = k < 6 ? oy + Math.sin(a) * pr * 0.46 : oy;
            ctx!.moveTo(fx + pr * 0.06, fy);
            ctx!.arc(fx, fy, pr * 0.06, 0, Math.PI * 2);
          }
          paint(pal.eye);
        } else if (pr > 1.6) {
          ctx!.beginPath();
          ctx!.arc(ox - pr * 0.22, oy - pr * 0.25, pr * 0.55, 0, Math.PI * 2);
          paint(tones.flowerLit[t]);
        }
      }
    }

    type YellowSprig = {
      c: [number, number, number];
      /** the cushion's outward normal there, to pass over the far side */
      n: [number, number, number];
      /** leaf corners as offsets from c, xyz; YELLOW_LEAF.length each */
      leaves: Float32Array;
      /** the same leaves as kites, YELLOW_KITE.length each */
      kites: Float32Array;
      inner: boolean;
      /** its step on the light ramp, 0 shade to YL_LEVELS - 1 lit */
      tone: number;
    };
    type YellowPlant = {
      sprigs: YellowSprig[];
      /** flower heads, 8 numbers each: centre, radius (ft), outward
       *  normal, step on the flower ramp */
      flowers: Float32Array;
      /** the heart of the cushion, set in from the leaves, hulled for the
       *  dark core */
      core: [number, number, number][];
    };
    // A lantana leaf, ovate to a point.
    const YELLOW_LEAF: [number, number][] = [[0, 0], [0.18, 0.42], [0.55, 0.46], [1, 0], [0.55, -0.46], [0.18, -0.42]];
    // The leaf as a kite of the same area, for leaves a few pixels long.
    const YELLOW_KITE: [number, number][] = [[0, 0], [0.4, 0.61], [1, 0], [0.4, -0.61]];
    const YL_LEVELS = 8;
    const YL_FLOWER_LEVELS = 4;
    // Tones made once, so a fill's colour is only set when the step changes.
    const YL_TONES = [YELLOW_LANTANA_COLOURS, YELLOW_LANTANA_GOLD].map((pal) => {
      const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
      const leaf = Array.from({ length: YL_LEVELS }, (_, k) => mix(pal.leafShade, pal.leafLit, 0.2 + (0.8 * k) / (YL_LEVELS - 1)));
      const step = (k: number) => k / (YL_FLOWER_LEVELS - 1);
      const ramp = (f: (t: number) => number[]) => Array.from({ length: YL_FLOWER_LEVELS }, (_, k) => rgb(f(step(k))));
      return {
        leaf: leaf.map(rgb),
        inner: leaf.map((c) => rgb(mix(pal.inner, c, 0.4))),
        flower: ramp((t) => mix(pal.flowerShade, pal.flower, t)),
        flowerLit: ramp((t) => mix(pal.flower, pal.flowerLit, 0.15 + 0.5 * t)),
        floret: ramp((t) => mix(mix(pal.flowerShade, pal.flower, t), pal.flowerLit, 0.45)),
        bud: ramp((t) => mix(pal.flowerShade, pal.bud, 0.5 + 0.5 * t)),
      };
    });
    const yellowGrown = new Map<string, YellowPlant>();
    // Scratch, reused plant to plant.
    let ylDepth = new Float32Array(2048);
    let ylOrder = new Int32Array(2048);

    function growYellowLantana(x: number, z: number, h: number, rw: number, rot: number, seed: string): YellowPlant {
      const rng = rngFor("yellow-lantana:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const crs = (a: V3, b: V3): V3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];

      // The outline: an oval a fifth narrower across the plant's yaw than
      // along it, as the scan is, and only gently lobed — this one is a full
      // round cushion, where the purple throws out arms.
      const ph2 = rng() * Math.PI * 2;
      const ph3 = rng() * Math.PI * 2;
      const ph5 = rng() * Math.PI * 2;
      const oval = (th: number) => rw * (1 - 0.2 * Math.sin(th - rot) ** 2);
      const edge = (th: number) =>
        oval(th) * (0.88 + 0.04 * Math.sin(2 * th + ph2) + 0.03 * Math.sin(3 * th + ph3) + 0.02 * Math.sin(5 * th + ph5));
      // The cushion: flat-topped, held high nearly to its edge and then
      // steep to the ground, a little hollow in the middle where the crown
      // opens, and lumpy all over.
      const lumps = Array.from({ length: 12 }, (_, i) => {
        const th = i * 2.399963 + rng();
        const r = rw * 0.75 * Math.sqrt((i + 0.5) / 12);
        return [x + Math.cos(th) * r, z + Math.sin(th) * r, (rng() < 0.3 ? -0.7 : 1) * (0.08 + 0.1 * rng()), rw * (0.1 + 0.08 * rng())];
      });
      const raw = (px: number, pz: number) => {
        const rho = Math.hypot(px - x, pz - z) / edge(Math.atan2(pz - z, px - x));
        if (rho >= 1) return 0;
        let lump = 0;
        for (const [lx, lz, a, sg] of lumps) lump += a * Math.exp(-((px - lx) ** 2 + (pz - lz) ** 2) / (sg * sg));
        return (1 - rho ** 5) ** 0.4 - 0.12 * Math.exp(-((rho / 0.3) ** 2)) + lump * (1 - rho ** 4);
      };
      // Scaled so the cushion stands a little under the plant's height: the
      // shoots standing out of it make up the rest.
      let top = 0;
      for (let i = 0; i < 400; i++) {
        const r = Math.sqrt((i + 0.5) / 400) * rw;
        top = Math.max(top, raw(x + Math.cos(i * 2.399963) * r, z + Math.sin(i * 2.399963) * r));
      }
      const S = (px: number, pz: number) => (raw(px, pz) * h * 0.82) / top;
      const e = rw * 0.03;
      const normalAt = (px: number, pz: number): V3 =>
        nrm([(S(px - e, pz) - S(px + e, pz)) / (2 * e), 1, (S(px, pz - e) - S(px, pz + e)) / (2 * e)]);
      // Down in the folds between lumps is darker.
      const foldAt = (px: number, pz: number) => {
        const f = rw * 0.07;
        const dip = (S(px + f, pz) + S(px - f, pz) + S(px, pz + f) + S(px, pz - f)) / 4 - S(px, pz);
        return 1 - Math.min(0.45, Math.max(0, dip / (h * 0.04)) * 0.45);
      };
      // Lit from above, darker low down, mottled a step either way.
      const toneAt = (c: V3, n: V3, dark: number) => {
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        const shade = (0.25 + 0.75 * lit) * (0.5 + 0.5 * Math.min(1, c[1] / (h * 0.7))) * dark * (0.72 + 0.5 * rng());
        const step = Math.round(((shade - 0.2) / 0.8) * (YL_LEVELS - 1)) + (rng() < 0.15 ? 2 : 0);
        return Math.max(0, Math.min(YL_LEVELS - 1, step));
      };

      const sprigs: YellowSprig[] = [];
      const L = rw * 0.062;
      // A cluster of three to five leaves round a shoot tip, lying in the
      // cushion's skin and lifting a little off it.
      const cluster = (c: V3, n: V3, len: number, inner: boolean, dark: number) => {
        const t1 = nrm(crs(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
        const t2 = crs(n, t1);
        const pts: number[] = [];
        const kts: number[] = [];
        const spin = rng() * Math.PI * 2;
        const m = 3 + Math.floor(rng() * 3);
        for (let j = 0; j < m; j++) {
          const a = spin + (j / m) * Math.PI * 2 + (rng() - 0.5) * 0.8;
          const l = len * (0.8 + 0.4 * rng());
          const lift = 0.15 + 0.35 * rng();
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const d = nrm([t1[0] * ca + t2[0] * sa + n[0] * lift, t1[1] * ca + t2[1] * sa + n[1] * lift, t1[2] * ca + t2[2] * sa + n[2] * lift]);
          const p = nrm(crs(n, d));
          for (const [f, q] of YELLOW_LEAF) for (let i = 0; i < 3; i++) pts.push(d[i] * l * f + p[i] * l * 0.7 * q);
          for (const [f, q] of YELLOW_KITE) for (let i = 0; i < 3; i++) kts.push(d[i] * l * f + p[i] * l * 0.7 * q);
        }
        sprigs.push({ c, n, leaves: new Float32Array(pts), kites: new Float32Array(kts), inner, tone: toneAt(c, n, dark) });
      };
      const flowers: number[] = [];
      // A flower head sitting up off the leaves; many open in pairs, two
      // heads touching, as the scan's do.
      const bloom = (c: V3, n: V3) => {
        const r = rw * (0.035 + 0.025 * rng());
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        const shade = (0.35 + 0.65 * lit) * (0.7 + 0.3 * Math.min(1, c[1] / (h * 0.6)));
        const tone = Math.max(0, Math.min(YL_FLOWER_LEVELS - 1, Math.round(shade * (YL_FLOWER_LEVELS - 1))));
        flowers.push(c[0] + n[0] * r * 0.6, c[1] + n[1] * r * 0.6, c[2] + n[2] * r * 0.6, r, n[0], n[1], n[2], tone);
        if (rng() < 0.4) {
          const t1 = nrm(crs(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
          const t2 = crs(n, t1);
          const a = rng() * Math.PI * 2;
          const r2 = r * (0.7 + 0.25 * rng());
          const d = r + r2 * 0.6;
          const ox = (t1[0] * Math.cos(a) + t2[0] * Math.sin(a)) * d;
          const oy = (t1[1] * Math.cos(a) + t2[1] * Math.sin(a)) * d;
          const oz = (t1[2] * Math.cos(a) + t2[2] * Math.sin(a)) * d;
          flowers.push(c[0] + ox + n[0] * r2 * 0.6, c[1] + oy + n[1] * r2 * 0.6, c[2] + oz + n[2] * r2 * 0.6, r2, n[0], n[1], n[2], tone);
        }
      };
      // A point on the cushion's top, or on its steep side down to the
      // ground.
      const onTop = (th: number, rho: number): [V3, V3, number] => {
        const r = rho * edge(th);
        const px = x + Math.cos(th) * r;
        const pz = z + Math.sin(th) * r;
        return [[px, S(px, pz), pz], normalAt(px, pz), foldAt(px, pz)];
      };
      const onSide = (th: number): [V3, V3] => {
        const ed = edge(th);
        const r = (0.9 + (rng() < 0.2 ? 0.16 : 0.08) * rng()) * ed;
        const shoulder = S(x + Math.cos(th) * ed * 0.9, z + Math.sin(th) * ed * 0.9);
        return [[x + Math.cos(th) * r, shoulder * (0.02 + 0.93 * rng()), z + Math.sin(th) * r], nrm([Math.cos(th), 0.35, Math.sin(th)])];
      };

      // The shaded layer under the leaves, so a gap shows leaves in shadow
      // before it shows the core.
      for (let i = 0; i < 140; i++) {
        const [c, n] = onTop(i * 2.399963, 0.95 * Math.sqrt((i + 0.5) / 140));
        cluster([c[0], c[1] - h * 0.09, c[2]], n, L * 1.1, true, 0.8);
      }
      // The skin, evenly over the top on a spiral, then round the sides.
      const NT = 480;
      for (let i = 0; i < NT; i++) {
        const [c, n, fold] = onTop(i * 2.399963 + (rng() - 0.5) * 0.2, Math.min(0.97, Math.sqrt((i + 0.5) / NT) + (rng() - 0.5) * 0.03));
        const proud = rng() < 0.12 ? h * (0.04 + 0.06 * rng()) : h * 0.04 * (rng() - 0.5);
        cluster([c[0] + n[0] * proud, c[1] + n[1] * proud, c[2] + n[2] * proud], n, L, false, fold);
      }
      for (let i = 0; i < 320; i++) {
        const [c, n] = onSide(i * 2.399963 + rng() * 0.3);
        cluster(c, n, L, false, 1);
      }
      // Shoots standing up out of the top, leafy, mostly with a head at the
      // tip, as the scan's do: they break the cushion's skyline.
      for (let i = 0; i < 18; i++) {
        const th = i * 2.399963 + rng();
        const [c0] = onTop(th, 0.1 + 0.8 * Math.sqrt(rng()));
        const rise = Math.min(h * (0.1 + 0.12 * rng()), h * 0.98 - c0[1]);
        const lean = 0.2 + 0.3 * rng();
        const up = nrm([Math.cos(th) * lean, 1, Math.sin(th) * lean]);
        let c: V3 = c0;
        for (let k = 1; k <= 4; k++) {
          const f = ((k / 4) * rise) / up[1];
          c = [c0[0] + up[0] * f, c0[1] + up[1] * f, c0[2] + up[2] * f];
          cluster(c, up, L * (1 - 0.08 * k), false, 1);
        }
        if (rng() < 0.75) bloom(c, up);
      }
      // Shoots reaching out of the sides past the edge, most of them about
      // halfway up, some trailing low, a head at the end of half of them.
      for (let i = 0; i < 18; i++) {
        const th = i * 2.399963 + rng() * 0.5;
        const ed = edge(th);
        const out = Math.min(oval(th), ed * (1.05 + 0.12 * rng())) / ed;
        const side = (rng() - 0.5) * 0.5;
        const low = rng() < 0.3;
        const y0 = S(x + Math.cos(th) * ed * 0.8, z + Math.sin(th) * ed * 0.8) * (low ? 0.3 : 0.55 + 0.3 * rng());
        const droop = low ? 0.22 : 0.06 + 0.06 * rng();
        const n = nrm([Math.cos(th), 1, Math.sin(th)]);
        let c: V3 = [x, 0, z];
        for (let k = 1; k <= 4; k++) {
          const f = (0.85 + ((out - 0.85) * k) / 4) * ed;
          const a = th + side * (k / 4);
          c = [x + Math.cos(a) * f, Math.max(h * 0.03, y0 * (1 - droop * k)), z + Math.sin(a) * f];
          cluster(c, n, L * 0.9, false, 1);
        }
        if (rng() < 0.5) bloom(c, n);
      }
      // Heads smothering it, the sides as well as the top.
      for (let i = 0; i < 200; i++) {
        const th = rng() * Math.PI * 2;
        if (rng() < 0.35) {
          const [c, n] = onSide(th);
          bloom(c, n);
        } else {
          const [c, n] = onTop(th, 0.96 * Math.sqrt(rng()));
          bloom(c, n);
        }
      }
      // The heart, set in from the skin.
      const core: V3[] = [];
      for (let i = 0; i < 16; i++) {
        const th = (i / 16) * Math.PI * 2;
        for (const rho of [0.25, 0.5, 0.75]) {
          const [c] = onTop(th, rho);
          core.push([c[0], c[1] * 0.85 - h * 0.04, c[2]]);
        }
        const r = 0.72 * edge(th);
        core.push([x + Math.cos(th) * r, 0, z + Math.sin(th) * r]);
      }
      // The shaded layer first, a step of tone at a time; the rest as grown.
      sprigs.sort((a, b) => (a.inner === b.inner ? (a.inner ? a.tone - b.tone : 0) : a.inner ? -1 : 1));
      return { sprigs, flowers: new Float32Array(flowers), core };
    }

    /** Yellow lantana, after the app's model.
     *
     *  A full round cushion, held high nearly to its edge and steep down to
     *  the ground — an oval a fifth narrower across than along, as the scan
     *  is — of dark green leaves in clusters, a few leafy shoots standing up
     *  out of its top. Smothered in golden heads, a third of them in pairs:
     *  close up, a ring of open florets round a deeper amber heart of buds.
     *
     *  Drawn as a dark core, then a shaded layer of leaves, then the skin's
     *  leaf clusters and the flowers far to near, the far side passed over;
     *  all through one local map at the cushion. Grown once and cached.
     */
    function drawYellowLantanaBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = yellowGrown.get(key);
      if (!grown) {
        if (yellowGrown.size > 400) yellowGrown.clear(); // growth and edits mint new keys
        grown = growYellowLantana(x, z, h, rw, rot, seed);
        yellowGrown.set(key, grown);
      }
      const pal = sel ? YELLOW_LANTANA_GOLD : YELLOW_LANTANA_COLOURS;
      const tones = YL_TONES[sel ? 1 : 0];

      // The local map at the cushion: screen x, y and depth per foot.
      const cy = h * 0.4;
      const q = P(x, cy, z);
      const qx = P(x + 1, cy, z);
      const qy = P(x, cy + 1, z);
      const qz = P(x, cy, z + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const sx = (px: number, py: number, pz: number) => q[0] + J[0] * (px - x) + J[1] * (py - cy) + J[2] * (pz - z);
      const sy = (px: number, py: number, pz: number) => q[1] + J[3] * (px - x) + J[4] * (py - cy) + J[5] * (pz - z);
      const depth = (px: number, py: number, pz: number) => q[2] + J[6] * (px - x) + J[7] * (py - cy) + J[8] * (pz - z);
      const facing = (c: ArrayLike<number>, n: ArrayLike<number>) =>
        n[0] * (eye[0] - c[0]) + n[1] * (eye[1] - c[1]) + n[2] * (eye[2] - c[2]) >= 0;

      const hull = convexHull(grown.core.map((v): [number, number] => [sx(v[0], v[1], v[2]), sy(v[0], v[1], v[2])]));
      ctx!.beginPath();
      for (let i = 0; i < hull.length; i++) {
        if (i) ctx!.lineTo(hull[i][0], hull[i][1]);
        else ctx!.moveTo(hull[i][0], hull[i][1]);
      }
      ctx!.fillStyle = pal.core;
      ctx!.fill();

      // Pixels a foot across the view: the longer of the two ground axes on
      // screen, which holds from overhead too (a foot up shrinks to nothing).
      const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]));
      // Kites while the leaves are under six pixels long.
      const kite = footPx * rw * 0.062 < 6;
      const n = kite ? YELLOW_KITE.length : YELLOW_LEAF.length;
      const leafPath = (sp: YellowSprig) => {
        const [cx, cy2, cz] = sp.c;
        const ox = sx(cx, cy2, cz);
        const oy = sy(cx, cy2, cz);
        const pts = kite ? sp.kites : sp.leaves;
        for (let o = 0; o < pts.length; o += n * 3) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const px = ox + J[0] * pts[i] + J[1] * pts[i + 1] + J[2] * pts[i + 2];
            const py = oy + J[3] * pts[i] + J[4] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(px, py);
            else ctx!.moveTo(px, py);
          }
          ctx!.closePath();
        }
      };
      const { sprigs, flowers } = grown;
      const m = sprigs.length;
      const nf = flowers.length / 8;
      if (ylDepth.length < m + nf) {
        ylDepth = new Float32Array((m + nf) * 2);
        ylOrder = new Int32Array((m + nf) * 2);
      }
      let fill = "";
      const paint = (col: string) => {
        if (col !== fill) ctx!.fillStyle = fill = col;
        ctx!.fill();
      };

      // The shaded layer.
      let m0 = 0;
      for (; m0 < m && sprigs[m0].inner; m0++) {
        const sp = sprigs[m0];
        if (!facing(sp.c, sp.n)) continue;
        ctx!.beginPath();
        leafPath(sp);
        paint(tones.inner[sp.tone]);
      }

      // The skin and the flowers far to near, the flowers a little nearer
      // than they stand, as they sit up over the leaves.
      let count = 0;
      for (let i = m0; i < m; i++) {
        const sp = sprigs[i];
        if (!facing(sp.c, sp.n)) continue;
        ylDepth[i] = depth(sp.c[0], sp.c[1], sp.c[2]);
        ylOrder[count++] = i;
      }
      for (let i = 0; i < nf; i++) {
        const f = flowers.subarray(i * 8, i * 8 + 8);
        if (!facing(f, f.subarray(4))) continue;
        ylDepth[m + i] = depth(f[0], f[1], f[2]) - 0.1;
        ylOrder[count++] = m + i;
      }
      const order = ylOrder.subarray(0, count).sort((a, b) => ylDepth[b] - ylDepth[a]);
      for (const i of order) {
        if (i < m) {
          ctx!.beginPath();
          leafPath(sprigs[i]);
          paint(tones.leaf[sprigs[i].tone]);
          continue;
        }
        // A dome of florets: the head, lit on its upper side, and close up
        // its ring of open florets, each with an eye, round the buds.
        const o = (i - m) * 8;
        const ox = sx(flowers[o], flowers[o + 1], flowers[o + 2]);
        const oy = sy(flowers[o], flowers[o + 1], flowers[o + 2]);
        // Far off, a head is a fleck of its lit colour, never under a pixel
        // and a bit across: the gold is what tells this lantana from the
        // other two.
        const pr = Math.max(1.4, flowers[o + 3] * footPx);
        const t = flowers[o + 7];
        // Nearer, the florets make the head's edge, so the head under them
        // is drawn smaller, and set down a little where it is in shadow.
        ctx!.beginPath();
        if (pr > 7) ctx!.arc(ox, oy, pr * 0.74, 0, Math.PI * 2);
        else if (pr > 3) ctx!.arc(ox + pr * 0.1, oy + pr * 0.12, pr * 0.8, 0, Math.PI * 2);
        else ctx!.arc(ox, oy, pr, 0, Math.PI * 2);
        paint(pr <= 3 ? tones.flowerLit[t] : tones.flower[t]);
        if (pr > 7) {
          // Florets crowd the head unevenly, lit on its upper side, a deeper
          // throat in each; the buds in the middle a warmer amber.
          const spin = flowers[o];
          const at = (k: number): [number, number, number] => {
            const a = (k / 7) * Math.PI * 2 + spin;
            const jit = (Math.sin(spin * 53 + k * 12.9898) * 43758.5453) % 1;
            const rr = pr * (0.55 + 0.12 * jit);
            return [ox + Math.cos(a) * rr, oy + Math.sin(a) * rr * 0.9, pr * (0.27 + 0.07 * Math.abs(jit))];
          };
          for (const lit of [false, true]) {
            ctx!.beginPath();
            for (let k = 0; k < 7; k++) {
              const [fx, fy, fr] = at(k);
              if ((fx - ox + (fy - oy) * 1.2 < 0) !== lit) continue;
              ctx!.moveTo(fx + fr, fy);
              ctx!.arc(fx, fy, fr, 0, Math.PI * 2);
            }
            paint(lit ? tones.flowerLit[t] : tones.floret[t]);
          }
          ctx!.beginPath();
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2 + spin + 0.5;
            ctx!.moveTo(ox + Math.cos(a) * pr * 0.16 + pr * 0.2, oy + Math.sin(a) * pr * 0.14);
            ctx!.arc(ox + Math.cos(a) * pr * 0.16, oy + Math.sin(a) * pr * 0.14, pr * 0.2, 0, Math.PI * 2);
          }
          paint(tones.bud[t]);
          ctx!.beginPath();
          for (let k = 0; k < 7; k++) {
            const [fx, fy] = at(k);
            ctx!.moveTo(fx + pr * 0.05, fy);
            ctx!.arc(fx, fy, pr * 0.05, 0, Math.PI * 2);
          }
          paint(pal.eye);
        } else if (pr > 3) {
          // Further off, a knot of lit florets making the head's lumpy edge,
          // matte: one lit disc on a darker one reads as a bead.
          ctx!.beginPath();
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + flowers[o];
            const fr = pr * (k ? 0.48 : 0.4);
            const fx = ox - pr * 0.05 + Math.cos(a) * pr * 0.42;
            const fy = oy - pr * 0.06 + Math.sin(a) * pr * 0.38;
            ctx!.moveTo(fx + fr, fy);
            ctx!.arc(fx, fy, fr, 0, Math.PI * 2);
          }
          paint(tones.flowerLit[t]);
        }
      }
    }

    function drawBarrelBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      stroke: string,
      fill: string,
      lw: number,
    ) {
      // The plant as a surface of revolution — a sphere squashed to its own
      // height. t runs 0 at the crown to 1 at the soil.
      const surf = (t: number, a: number) => {
        const th = t * Math.PI;
        const r = rw * Math.sin(th);
        return P(x + Math.cos(a) * r, (h / 2) * (1 + Math.cos(th)), z + Math.sin(a) * r);
      };

      const cloud: [number, number][] = [];
      for (let i = 0; i <= 8; i++)
        for (let k = 0; k < 18; k++) {
          const q = surf(i / 8, (k / 18) * Math.PI * 2);
          cloud.push([q[0], q[1]]);
        }
      const hull = convexHull(cloud);
      if (hull.length < 3) return;

      ctx!.beginPath();
      ctx!.moveTo(hull[0][0], hull[0][1]);
      for (let i = 1; i < hull.length; i++) ctx!.lineTo(hull[i][0], hull[i][1]);
      ctx!.closePath();
      ctx!.fillStyle = LEAF_BODY;
      ctx!.fill();
      ctx!.fillStyle = fill;
      ctx!.fill();
      ctx!.strokeStyle = stroke;
      ctx!.lineWidth = lw;
      ctx!.lineJoin = "round";
      ctx!.stroke();

      // Spines: short ticks standing off the rim at an even spacing round
      // the outline, which is what the serrations in the plan mark are.
      let perim = 0;
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      const cxs = hull.reduce((t, q) => t + q[0], 0) / hull.length;
      const cys = hull.reduce((t, q) => t + q[1], 0) / hull.length;
      const spike = Math.max(2, Math.min(perim * 0.018, 9));
      const step = perim / 26;
      let carry = 0;
      ctx!.lineWidth = lw * 0.6;
      ctx!.beginPath();
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        for (let d = carry; d < seg; d += step) {
          const u = d / seg;
          const px = a[0] + (b[0] - a[0]) * u;
          const py = a[1] + (b[1] - a[1]) * u;
          const nx = px - cxs;
          const ny = py - cys;
          const nl = Math.hypot(nx, ny) || 1;
          ctx!.moveTo(px, py);
          ctx!.lineTo(px + (nx / nl) * spike, py + (ny / nl) * spike);
        }
        carry = step - ((seg - carry) % step);
      }
      ctx!.stroke();

      // Ribs, but only the ones facing us: the body is opaque, so drawing
      // the far side as well would read as a wireframe.
      const mid = P(x, h / 2, z);
      ctx!.lineWidth = lw * 0.7;
      for (let k = 0; k < 13; k++) {
        const a = rot + (k / 13) * Math.PI * 2;
        if (surf(0.5, a)[2] >= mid[2]) continue;
        ctx!.beginPath();
        for (let i = 0; i <= 9; i++) {
          const q = surf(0.08 + (i / 9) * 0.86, a);
          if (i) ctx!.lineTo(q[0], q[1]);
          else ctx!.moveTo(q[0], q[1]);
        }
        ctx!.stroke();
      }

      // The crown: the wool and new spines sit in a tight ring on top.
      ctx!.beginPath();
      for (let k = 0; k <= 16; k++) {
        const q = surf(0.17, (k / 16) * Math.PI * 2);
        if (k) ctx!.lineTo(q[0], q[1]);
        else ctx!.moveTo(q[0], q[1]);
      }
      ctx!.closePath();
      ctx!.lineWidth = lw * 0.7;
      ctx!.stroke();
      ctx!.lineWidth = lw;
    }

    function drawTrunk(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      stroke: string,
      lw: number,
    ) {
      // Taper in feet, floored in pixels so a tree on an acre plan still has
      // a visible stem.
      const limbQuad = (
        ay: number,
        by: number,
        ar: number,
        br: number,
        aOut: number,
        bOut: number,
        az: number,
      ) => {
        const ca = Math.cos(az);
        const sa = Math.sin(az);
        const A = P(x + ca * aOut, ay, z + sa * aOut);
        const B = P(x + ca * bOut, by, z + sa * bOut);
        const dx = B[0] - A[0];
        const dy = B[1] - A[1];
        const L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L;
        const ny = dx / L;
        const wa = Math.max(ftPx(x, z, ar), 0.9);
        const wb = Math.max(ftPx(x, z, br), 0.6);
        ctx!.beginPath();
        ctx!.moveTo(A[0] + nx * wa, A[1] + ny * wa);
        ctx!.lineTo(B[0] + nx * wb, B[1] + ny * wb);
        ctx!.lineTo(B[0] - nx * wb, B[1] - ny * wb);
        ctx!.lineTo(A[0] - nx * wa, A[1] - ny * wa);
        ctx!.closePath();
        ctx!.fillStyle = LEAF_BODY;
        ctx!.fill();
        ctx!.fillStyle = verde(0.22);
        ctx!.fill();
        ctx!.strokeStyle = stroke;
        ctx!.lineWidth = lw * 0.8;
        ctx!.lineJoin = "round";
        ctx!.stroke();
      };

      const forkY = h * 0.27;
      const r0 = Math.max(rw * 0.055, 0.16); // half-width at the ground, ft
      const r1 = r0 * 0.66; // at the fork
      // Bole first, then the limbs over it, so the joint is covered.
      limbQuad(0, forkY, r0, r1, 0, 0, 0);
      for (let k = 0; k < 3; k++) {
        const az = rot + (k / 3) * Math.PI * 2;
        limbQuad(forkY, h * (0.56 + 0.1 * (k % 2)), r1 * 0.78, r1 * 0.24, 0, rw * 0.27, az);
      }
    }

    /** Aloe vera, after the app's model.
     *
     *  It drew as the generic rosette: nine bare strokes, a tuft of grass.
     *  The headset's Aloe Vera is a low fountain, about two-thirds as tall
     *  as it is wide (0.53 m by 0.81 m): an upright core of young leaves,
     *  older ones arching out around it, and the oldest swept nearly flat
     *  at the edge, some with their tips hooked over. Fifteen leaves on the
     *  golden angle, aged outward, reproduce that.
     *
     *  An aloe leaf is a succulent's: thick and full of water, where an
     *  agave's is a hard flat blade. So each leaf is drawn as a solid — a
     *  channelled upper face (two halves, margins raised above the midline)
     *  over a rounded underside that bellies out below the margins — four
     *  faces, each tinted by its own outward normal against the sheet's
     *  light (the boulder's). Seen from above it is a trough; from the side or
     *  from under its arch it shows its depth, which is what reads as
     *  fleshy. Small teeth on the older leaves' margins, and the pale flecks
     *  vera carries.
     *
     *  And it is in flower: two slender stalks out of the crown, about twice
     *  the height of the leaves, each ending in a spike of hanging yellow
     *  tubes with the buds still pointing up at the tip. Nothing else in the
     *  yard has that, so it is the quickest way to know the plant is an aloe.
     *
     *  Spread is the catalog's, so the outermost tips land on the plan mark's
     *  rim; height follows the model's proportion from there, capped by the
     *  catalog's.
     */
    function drawAloeBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      tint: (a: number) => string,
      stroke: string,
      lw: number,
      inColour: boolean,
    ) {
      const rng = rngFor("aloe:" + seed);
      // Up and to the left, the light every drawing on this sheet is under.
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const N = 15;
      const S = 14; // stations along a leaf; the odd ones carry the teeth
      const FOLD = 0.3; // margins above the midline, of the half-width
      const BELLY = 0.95; // underside below the margins, of the half-width
      const deg = Math.PI / 180;

      type V3 = [number, number, number];
      type Pt = [number, number];
      type Face = { pts: Pt[]; edges: { line: Pt[]; w: number; a: number | null }[]; flecks: Pt[][]; d: number; lit: number };

      // Centre lines first, in feet: a leaf leaves the crown at its own
      // angle and bends down along its length, the old ones the most.
      const leaves: { c: V3[]; psi: number[]; halfW: number; age: number; flecked: boolean }[] = [];
      let top = 0;
      for (let k = 0; k < N; k++) {
        const age = 1 - k / (N - 1); // 1 = oldest and outermost, 0 = youngest
        const a = rot + k * 2.399963 + (rng() - 0.5) * 0.35; // golden angle
        // Most leaves fan out long and open, as the model's do; only the
        // last few stand up in the core.
        const e0 = (80 - 44 * Math.pow(age, 0.7) + (rng() - 0.5) * 10) * deg;
        const bend = (8 + 56 * Math.pow(age, 1.2) + (rng() - 0.5) * 12) * deg;
        // A few tips hook over, as the model's do.
        const hook = rng() < 0.35 ? (15 + rng() * 25) * deg : 0;
        const sway = (rng() - 0.5) * 28 * deg;
        const L =
          rw * (1.45 - 0.45 * age) * (0.78 + 0.22 * Math.min(1, age / 0.2)) * (0.92 + 0.16 * rng());
        const r0 = rw * 0.08; // a crown, not a point
        const c: V3[] = [];
        const psi: number[] = [];
        let y = 0;
        let px = x + Math.cos(a) * r0;
        let pz = z + Math.sin(a) * r0;
        for (let i = 0; i <= S; i++) {
          const t = i / S;
          const ps = a + sway * t * t;
          if (i > 0) {
            const tm = (i - 0.5) / S;
            const e =
              e0 - bend * Math.pow(tm, 1.5) - hook * Math.max(0, (tm - 0.7) / 0.3) ** 2;
            const step = L / S;
            px += Math.cos(e) * Math.cos(ps) * step;
            pz += Math.cos(e) * Math.sin(ps) * step;
            y += Math.sin(e) * step;
          }
          c.push([px, Math.max(y, 0), pz]);
          psi.push(ps);
          top = Math.max(top, y);
        }
        // Drawn broader than life, as the agaves are: at plan scale a
        // true-width leaf thins back into a stroke and the succulent is lost.
        const halfW = rw * (0.11 + 0.07 * age) * (0.9 + 0.2 * rng());
        leaves.push({ c, psi, halfW, age, flecked: rng() < 0.35 });
      }
      // Height follows the model's proportion; the catalog's is a ceiling.
      const ys = top > h * 0.95 ? (h * 0.95) / top : 1;

      const faces: Face[] = [];
      const proj = (v: V3): Pt => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      };
      const depth = (v: V3) => P(v[0], v[1], v[2])[2];
      for (const lf of leaves) {
        const c = lf.c.map(([cx, cy, cz]): V3 => [cx, cy * ys, cz]);
        // Broad at the clasp and holding its width most of the way out —
        // a fleshy leaf, not a needle — then closing to a point.
        const width = (t: number) => lf.halfW * Math.pow(1 - t, 0.7) * (0.85 + 0.15 * Math.min(1, t / 0.07));
        const marginL: V3[] = [];
        const marginR: V3[] = [];
        const keel: V3[] = [];
        const frames: { T: V3; Sd: V3; Nn: V3 }[] = [];
        for (let i = 0; i <= S; i++) {
          const t = i / S;
          const p0 = c[Math.max(0, i - 1)];
          const p1 = c[Math.min(S, i + 1)];
          const dx = p1[0] - p0[0];
          const dy = p1[1] - p0[1];
          const dz = p1[2] - p0[2];
          const tl = Math.hypot(dx, dy, dz) || 1;
          const T: V3 = [dx / tl, dy / tl, dz / tl];
          const Sd: V3 = [-Math.sin(lf.psi[i]), 0, Math.cos(lf.psi[i])]; // across, level
          // Sd x T: the upper face's normal — in toward the crown on an
          // upright leaf, up on an open one.
          let Nn: V3 = [Sd[1] * T[2] - Sd[2] * T[1], Sd[2] * T[0] - Sd[0] * T[2], Sd[0] * T[1] - Sd[1] * T[0]];
          const nl = Math.hypot(...Nn) || 1;
          Nn = [Nn[0] / nl, Nn[1] / nl, Nn[2] / nl];
          frames.push({ T, Sd, Nn });
          const w = width(t);
          // A tooth is a margin vertex pushed out, on the older leaves.
          const tooth = lf.age > 0.25 && i % 2 === 1 && i > 1 && i < S - 1 ? lf.halfW * 0.12 * (1 - 0.6 * t) : 0;
          const at = (side: number, across: number, up: number): V3 => [
            c[i][0] + Sd[0] * side * across + Nn[0] * up,
            c[i][1] + Nn[1] * up,
            c[i][2] + Sd[2] * side * across + Nn[2] * up,
          ];
          marginL.push(at(1, w + tooth, FOLD * w));
          marginR.push(at(-1, w + tooth, FOLD * w));
          keel.push(at(1, 0, -BELLY * w));
        }
        const fold = c;
        const k = Math.round(S * 0.35);
        // The middle of the leaf's section, for pointing each face's normal
        // OUT of the leaf. Not the boulder's absolute value: that lights an
        // underside facing the ground as brightly as a top facing the sky,
        // and the dark belly under a light trough is what reads as thick.
        const mid: V3 = [
          c[k][0] - frames[k].Nn[0] * BELLY * width(k / S) * 0.4,
          c[k][1] - frames[k].Nn[1] * BELLY * width(k / S) * 0.4,
          c[k][2] - frames[k].Nn[2] * BELLY * width(k / S) * 0.4,
        ];
        const litOf = (a: V3, b: V3) => {
          const T = frames[k].T;
          const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          let nx = T[1] * ac[2] - T[2] * ac[1];
          let ny = T[2] * ac[0] - T[0] * ac[2];
          let nz = T[0] * ac[1] - T[1] * ac[0];
          const out = [(a[0] + b[0]) / 2 - mid[0], (a[1] + b[1]) / 2 - mid[1], (a[2] + b[2]) / 2 - mid[2]];
          if (nx * out[0] + ny * out[1] + nz * out[2] < 0) [nx, ny, nz] = [-nx, -ny, -nz];
          const d = (nx * LX + ny * LY + nz * LZ) / (Math.hypot(nx, ny, nz) || 1);
          return 0.3 + 0.7 * Math.max(0, d); // a floor, so a face in shade is still paper
        };
        const strip = (a: V3[], b: V3[]) => [...a.map(proj), ...[...b].reverse().map(proj)];
        const meanDepth = (a: V3[], b: V3[]) =>
          (a.reduce((s, v) => s + depth(v), 0) + b.reduce((s, v) => s + depth(v), 0)) / (a.length + b.length);
        for (const [margin, side] of [[marginL, 1], [marginR, -1]] as [V3[], number][]) {
          // Upper half: the midline to the raised margin. Flecks sit here.
          const flecks: Pt[][] = [];
          if (lf.flecked) {
            const n = 2 + Math.floor(rng() * 2);
            for (let f = 0; f < n; f++) {
              const i = 2 + Math.floor(rng() * (S * 0.45));
              const s0 = 0.25 + rng() * 0.35;
              const w = width(i / S);
              const { Sd, Nn } = frames[i];
              const pt = (s: number): V3 => [
                c[i][0] + Sd[0] * side * w * s + Nn[0] * FOLD * w * s,
                c[i][1] + Nn[1] * FOLD * w * s,
                c[i][2] + Sd[2] * side * w * s + Nn[2] * FOLD * w * s,
              ];
              flecks.push([proj(pt(s0)), proj(pt(s0 + 0.28))]);
            }
          }
          faces.push({
            pts: strip(fold, margin),
            edges: [
              { line: fold.map(proj), w: 0.5, a: 0.45 },
              { line: margin.map(proj), w: 1, a: null },
            ],
            flecks,
            d: meanDepth(fold, margin),
            lit: litOf(fold[k], margin[k]),
          });
          // Underside half: the margin round to the keel. This is the
          // succulent's body, and what an agave blade has no room for.
          faces.push({
            pts: strip(margin, keel),
            edges: [
              { line: keel.map(proj), w: 0.6, a: 0.55 },
              { line: margin.map(proj), w: 1, a: null },
            ],
            flecks: [],
            d: meanDepth(margin, keel),
            lit: litOf(margin[k], keel[k]),
          });
        }
      }

      const line = (pts: Pt[]) => {
        ctx!.beginPath();
        ctx!.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx!.lineTo(pts[i][0], pts[i][1]);
      };
      const drawFace = (f: Face) => {
        line(f.pts);
        ctx!.closePath();
        // Paper under every face, or the translucent tints stack and the
        // far leaves show through the near ones.
        ctx!.fillStyle = LEAF_BODY;
        ctx!.fill();
        ctx!.fillStyle = tint(0.04 + 0.42 * (1 - f.lit));
        ctx!.fill();
        if (f.flecks.length) {
          ctx!.strokeStyle = "rgba(246,240,226,0.85)";
          ctx!.lineWidth = Math.max(lw * 0.8, 1);
          ctx!.lineCap = "round";
          for (const fl of f.flecks) {
            line(fl);
            ctx!.stroke();
          }
          ctx!.lineCap = "butt";
        }
        for (const e of f.edges) {
          line(e.line);
          ctx!.strokeStyle = e.a === null ? stroke : tint(e.a);
          ctx!.lineWidth = lw * e.w;
          ctx!.stroke();
        }
      };
      // Leaves, stalks and flowers go through one depth sort, so a near leaf
      // still covers the foot of a stalk rising behind it.
      const items: { d: number; draw: () => void }[] = faces.map((f) => ({ d: f.d, draw: () => drawFace(f) }));
      const seg = (a: V3, b: V3, w: number, col: string, cap: CanvasLineCap = "round") => {
        const pa = proj(a);
        const pb = proj(b);
        ctx!.beginPath();
        ctx!.moveTo(pa[0], pa[1]);
        ctx!.lineTo(pb[0], pb[1]);
        ctx!.lineWidth = w;
        ctx!.strokeStyle = col;
        ctx!.lineCap = cap;
        ctx!.stroke();
        ctx!.lineCap = "butt";
      };

      // The blooms. Each stalk leaves the crown from among the leaves, leans
      // a little outward and away from its partner, and carries its flowers
      // on the top third: open tubes hanging at the bottom of the spike,
      // shorter and turning up toward the buds at the tip.
      const leafTop = top * ys;
      const stalkW = Math.max(ftPx(x, z, 0.04), lw * 0.9);
      const tubeW = Math.max(ftPx(x, z, 0.035), 1.6);
      const open = inColour ? ALOE_BLOOM : tint(0.3);
      const bud = inColour ? ALOE_BUD : tint(0.22);
      const lean0 = rot + rng() * Math.PI * 2;
      for (let st = 0; st < 2; st++) {
        const la = lean0 + st * (Math.PI * 0.8 + rng() * 0.6);
        const lean = Math.sin((5 + rng() * 9) * deg);
        const tall = leafTop * (1.85 + rng() * 0.3);
        const bx = x + Math.cos(la) * rw * 0.05;
        const bz = z + Math.sin(la) * rw * 0.05;
        const by = leafTop * 0.08;
        const along = (t: number): V3 => {
          const off = tall * lean * Math.pow(t, 1.4); // bends out more toward the top
          return [bx + Math.cos(la) * off, by + (tall - by) * t, bz + Math.sin(la) * off];
        };
        const SEGS = 10;
        for (let i = 0; i < SEGS; i++) {
          const a = along(i / SEGS);
          const b = along((i + 1) / SEGS);
          const w = stalkW * (1 - 0.35 * (i / SEGS));
          // Butt ends: the stalk is drawn in pieces for the depth sort, and
          // round caps on a translucent ink overlap into beads at every joint.
          items.push({ d: (depth(a) + depth(b)) / 2, draw: () => seg(a, b, w, tint(0.7), "butt") });
        }
        const M = 16; // whorls up the spike
        for (let j = 0; j < M; j++) {
          const u = j / (M - 1); // 0 = the lowest, open flowers; 1 = the tip
          const ax = along(0.68 + 0.315 * u);
          const tilt = (-62 + 102 * Math.pow(u, 1.3)) * deg; // hanging, then up
          const len = rw * (0.12 - 0.075 * u);
          const col = u > 0.72 ? bud : open;
          for (let m = 0; m < 3; m++) {
            const phi = st * 1.3 + j * 2.399963 + (m * Math.PI * 2) / 3;
            const hx = Math.cos(phi);
            const hz = Math.sin(phi);
            const base: V3 = [ax[0] + hx * rw * 0.02, ax[1], ax[2] + hz * rw * 0.02];
            const tip: V3 = [
              base[0] + hx * Math.cos(tilt) * len,
              base[1] + Math.sin(tilt) * len,
              base[2] + hz * Math.cos(tilt) * len,
            ];
            items.push({
              d: (depth(base) + depth(tip)) / 2,
              draw: () => {
                // The lantana's order: ink edge, paper, then the colour.
                seg(base, tip, tubeW + lw * 0.7, tint(0.6));
                seg(base, tip, tubeW, LEAF_BODY);
                seg(base, tip, tubeW, col);
              },
            });
          }
        }
      }

      // Far first, so the near ones lie over them.
      items.sort((p, q) => q.d - p.d);
      ctx!.lineJoin = "round";
      for (const it of items) it.draw();
    }

    // A hopseed's leaves don't move when the camera does, so they are grown
    // once per plant and kept: hundreds of sprays of rng and vector maths
    // every frame was most of what a hedge of them cost.
    type HopseedSpray = {
      c: [number, number, number];
      /** leaf corners, as offsets from c: 5 leaves x 6 corners x xyz */
      off: Float32Array;
      inner: boolean;
      col: string;
      gold: string;
    };
    const hopseedGrown = new Map<string, { stems: [number, number, number][][]; sprays: HopseedSpray[] }>();

    function growHopseed(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
      const rng = rngFor("hopseed:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const crs = (a: V3, b: V3): V3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      // The column, as a radius of its spread at each fraction of its
      // height: pinched where the stems gather, full and nearly straight-
      // sided through the middle, rounding off over the top quarter. Rounding
      // from a third of the way down made an egg; the model is a column.
      const prof = (u: number) =>
        (0.42 + 0.58 * smooth(0.05, 0.24, u)) *
        (u > 0.72 ? Math.pow(Math.max(0, 1 - ((u - 0.72) / 0.28) ** 2), 0.4) : 1);

      const stems: V3[][] = [];
      for (let k = 0; k < 5; k++) {
        const a = rot + k * 2.399963 + rng() * 0.5;
        stems.push([
          [x + Math.cos(a) * rw * 0.04, 0, z + Math.sin(a) * rw * 0.04],
          [x + Math.cos(a) * rw * 0.3, h * 0.24, z + Math.sin(a) * rw * 0.3],
        ]);
      }

      // Two layers: an inner one in shadow, which is what you see through
      // the gaps, and the outer skin. Depth from leaves, not from a shape —
      // a filled hull behind them read as a dark can, however small. Placed
      // by area (fewer where the column is narrow), with a little lumpiness
      // round it so the outline is tufted, not turned.
      const NI = 140;
      const NS = 240;
      const s1 = rng() * 6.28;
      const s2 = rng() * 6.28;
      const sprays: HopseedSpray[] = [];
      for (let tries = 0; sprays.length < NS + NI && tries < (NS + NI) * 4; tries++) {
        const inner = sprays.length < NI;
        const u = 0.1 + 0.88 * rng();
        if (rng() > prof(u)) continue;
        const th = rng() * Math.PI * 2;
        const tuft = 1 + 0.07 * Math.sin(4 * th + 9 * u + s1) + 0.05 * Math.sin(7 * th - 5 * u + s2);
        const r = rw * prof(u) * (inner ? 0.5 + 0.3 * rng() : 0.86 + 0.16 * rng()) * tuft;
        const c: V3 = [x + Math.cos(th) * r, u * h, z + Math.sin(th) * r];
        const n = nrm([Math.cos(th), (u - 0.45) * 1.2, Math.sin(th)]); // tipped up toward the crown
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        const shade = (0.3 + 0.7 * lit) * (0.5 + 0.5 * smooth(0.05, 0.75, u));
        const fresh = !inner && u > 0.6 && rng() < 0.3;
        const tone = (pal: typeof HOPSEED_LEAF) => {
          let col = mix(pal.shade, pal.lit, shade);
          if (inner) col = mix(pal.core, col, 0.35);
          else if (fresh) col = mix(col, pal.fresh, 0.55);
          return rgb(col);
        };
        // A spray points up and a little out; its leaves alternate up it and
        // one finishes it. Each is a lance, widest a third of the way out and
        // drawn to a point — four corners made a diamond, which is a privet.
        const tw = nrm([n[0] * 0.35 + (rng() - 0.5) * 0.3, 1, n[2] * 0.35 + (rng() - 0.5) * 0.3]);
        const side = nrm(crs(tw, n));
        const L = rw * 0.2 * (0.85 + 0.3 * rng());
        const twig = rw * 0.32;
        const w = L * 0.14; // narrow, willow-like
        const off = new Float32Array(5 * 6 * 3);
        let o = 0;
        [0.15, 0.35, 0.55, 0.75, 1].forEach((t, j) => {
          const sg = j % 2 ? 1 : -1;
          const a = j === 4 ? 1 : 0.7071;
          const b = j === 4 ? 0 : 0.7071 * sg;
          const dir = nrm([
            tw[0] * a + side[0] * b + n[0] * 0.15,
            tw[1] * a + side[1] * b + n[1] * 0.15,
            tw[2] * a + side[2] * b + n[2] * 0.15,
          ]);
          const perp = nrm(crs(dir, n));
          for (const [f, q] of [[0, 0], [0.3, 1], [0.7, 0.5], [1, 0], [0.7, -0.5], [0.3, -1]]) {
            for (let i = 0; i < 3; i++) off[o++] = tw[i] * twig * t + dir[i] * L * f + perp[i] * w * q;
          }
        });
        sprays.push({ c, off, inner, col: tone(HOPSEED_LEAF), gold: tone(HOPSEED_GOLD) });
      }
      return { stems, sprays };
    }

    /** Green hopseed, after the app's model.
     *
     *  Shrubs drew as the trees do, the plan mark lifted onto a canopy disc,
     *  which says something round and green is here and nothing about which
     *  shrub. The headset's hopseed is a dense upright column: a few bare
     *  stems out of a tight base, then foliage from knee height to a softly
     *  rounded, tufted top, all of it narrow willow-like leaves in sprays
     *  that point up.
     *
     *  So that is what is drawn: the stems; an inner layer of sprays in
     *  shade, so the gaps read as depth rather than holes; and sprays of five
     *  narrow leaves over the column's skin, far first. Each spray takes its
     *  green from where it sits — its outward normal against the sheet's
     *  light (the boulder's), darker low down — and a few near the top carry
     *  the paler new growth. Leaves are drawn larger than life, as the
     *  agave's are, or at yard scale they would be dust.
     *
     *  Cost: each spray projects four points (its centre, and a foot along
     *  each axis) and places its thirty leaf corners from those, which is
     *  exact enough at leaf size and a seventh of the projections. The inner
     *  layer is filled only; an outline on a leaf in shadow is just noise.
     */
    function drawHopseedBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = hopseedGrown.get(key);
      if (!grown) {
        if (hopseedGrown.size > 400) hopseedGrown.clear(); // growth and edits mint new keys
        grown = growHopseed(x, z, h, rw, rot, seed);
        hopseedGrown.set(key, grown);
      }

      // Stems, first: the foliage closes over them above the base.
      ctx!.strokeStyle = sel ? gold(0.8) : "rgba(98,82,64,0.9)";
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.16), lw);
      ctx!.lineCap = "round";
      for (const [a, b] of grown.stems) {
        const p0 = P(a[0], a[1], a[2]);
        const p1 = P(b[0], b[1], b[2]);
        ctx!.beginPath();
        ctx!.moveTo(p0[0], p0[1]);
        ctx!.lineTo(p1[0], p1[1]);
        ctx!.stroke();
      }
      ctx!.lineCap = "butt";

      const order = grown.sprays.map((sp) => {
        const [cx, cy, cz] = sp.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { sp, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      ctx!.lineJoin = "round";
      ctx!.lineWidth = lw * 0.45;
      ctx!.strokeStyle = sel ? gold(0.6) : ink(0.4);
      for (const { sp, q, J } of order) {
        const off = sp.off;
        ctx!.beginPath();
        for (let o = 0; o < off.length; o += 18) {
          for (let k = 0; k < 6; k++) {
            const i = o + k * 3;
            const sx = q[0] + J[0] * off[i] + J[2] * off[i + 1] + J[4] * off[i + 2];
            const sy = q[1] + J[1] * off[i] + J[3] * off[i + 1] + J[5] * off[i + 2];
            if (k) ctx!.lineTo(sx, sy);
            else ctx!.moveTo(sx, sy);
          }
          ctx!.closePath();
        }
        ctx!.fillStyle = sel ? sp.gold : sp.col;
        ctx!.fill();
        if (!sp.inner) ctx!.stroke();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the hopseed is.
    type SageTuft = {
      c: [number, number, number];
      /** leaf corners then spike corners, as offsets from c, xyz */
      leaves: Float32Array;
      spikes: Float32Array;
      inner: boolean;
      leafCol: [string, string]; // [plain, gold]
      spikeCol: [string, string];
    };
    const sageGrown = new Map<string, SageTuft[]>();
    // The sage's core: its shell set back from the leaves, as points round
    // the dome, filled as one silhouette each frame.
    const sageCoreRing = (x: number, z: number, h: number, rw: number): [number, number, number][] => {
      const out: [number, number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const u = 0.04 + (0.86 * i) / 10;
        const r = rw * 0.8 * (u < 0.3 ? 0.8 + 0.2 * (u / 0.3) : Math.pow(Math.max(0, 1 - ((u - 0.3) / 0.7) ** 2), 0.42));
        for (let j = 0; j < 16; j++) {
          const th = (j / 16) * Math.PI * 2;
          out.push([x + Math.cos(th) * r, u * h, z + Math.sin(th) * r]);
        }
      }
      return out;
    };

    function growTexasSage(x: number, z: number, h: number, rw: number, seed: string): SageTuft[] {
      const rng = rngFor("texassage:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const crs = (a: V3, b: V3): V3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      // A dome sitting on the ground: foliage right down to the soil, widest
      // a third of the way up, rounding over the top. No stems show.
      const prof = (u: number) =>
        u < 0.3 ? 0.8 + 0.2 * smooth(0, 0.3, u) : Math.pow(Math.max(0, 1 - ((u - 0.3) / 0.7) ** 2), 0.42);

      // Corners of a soft oval leaf and of a bloom spike, along (1, 0) with
      // the width on the second axis: [along, across] fractions.
      const OVAL: [number, number][] = [[0, 0], [0.2, 0.42], [0.55, 0.5], [0.9, 0.3], [1, 0], [0.9, -0.3], [0.55, -0.5], [0.2, -0.42]];
      const SPIKE: [number, number][] = [[0, -0.45], [0.3, -1], [0.65, -0.75], [1, 0], [0.65, 0.75], [0.3, 1], [0, 0.45]];
      const put = (out: number[], base: V3, dir: V3, perp: V3, len: number, wid: number, shape: [number, number][]) => {
        for (const [f, q] of shape) {
          for (let i = 0; i < 3; i++) out.push(base[i] + dir[i] * len * f + perp[i] * wid * q);
        }
      };

      // The mass: big soft clumps of grey foliage under everything, fill
      // only. A sage is a dense mound; tufts alone left it mostly air.
      const NI = 190;
      const NS = 300;
      const s1 = rng() * 6.28;
      const tufts: SageTuft[] = [];
      for (let tries = 0; tufts.length < NS + NI && tries < (NS + NI) * 4; tries++) {
        const inner = tufts.length < NI;
        const u = 0.02 + 0.96 * rng();
        // By area. Up the straight lower third that follows the radius; over
        // the dome it doesn't — a sphere has as much skin per foot of height
        // at the crown as at the waist, and thinning by radius left the top,
        // the part the camera looks down on, nearly bare.
        if (u < 0.3 && rng() > prof(u)) continue;
        const th = rng() * Math.PI * 2;
        const lump = 1 + 0.05 * Math.sin(5 * th + 7 * u + s1);
        const r = rw * prof(u) * (inner ? 0.72 + 0.18 * rng() : 0.92 + 0.1 * rng()) * lump;
        const c: V3 = [x + Math.cos(th) * r, Math.min(u * h, h * 0.97), z + Math.sin(th) * r];
        const n = nrm([Math.cos(th) * prof(u), (u - 0.25) * 1.6, Math.sin(th) * prof(u)]);
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        const shade = (0.3 + 0.7 * lit) * (0.55 + 0.45 * smooth(0, 0.6, u));
        const side = nrm(crs([0, 1, 0], n[1] > 0.98 ? [1, 0, 0] : n));
        const leaves: number[] = [];
        const spikes: number[] = [];
        // A tuft's woolly leaves, lying along the surface and fanned.
        const nl = inner ? 3 : 4;
        const L = rw * (inner ? 0.2 : 0.085) * (0.85 + 0.3 * rng());
        for (let k = 0; k < nl; k++) {
          const a = (k / nl) * Math.PI * 2 + rng() * 0.8;
          const dir = nrm([
            n[0] * 0.5 + side[0] * Math.cos(a) * 0.8,
            n[1] * 0.5 + 0.35 + Math.sin(a) * 0.5,
            n[2] * 0.5 + side[2] * Math.cos(a) * 0.8,
          ]);
          const perp = nrm(crs(dir, n));
          put(leaves, [0, 0, 0], dir, perp, L, L * 0.55, OVAL);
        }
        // Bloom spikes: up and a little out, mostly on the upper two thirds.
        const blooming = !inner && rng() < 0.35 + 0.6 * smooth(0.1, 0.45, u);
        const pale = rng() < 0.45;
        if (blooming) {
          const ns = 3 + Math.floor(rng() * 2);
          for (let k = 0; k < ns; k++) {
            const dir = nrm([
              n[0] * 0.45 + (rng() - 0.5) * 0.35,
              0.85 + (rng() - 0.5) * 0.2,
              n[2] * 0.45 + (rng() - 0.5) * 0.35,
            ]);
            const perp = nrm(crs(dir, n[1] > 0.98 ? [1, 0, 0] : n));
            // Slim: a short raceme of small bells, not a petal.
            const Ls = rw * 0.15 * (0.75 + 0.45 * rng());
            put(spikes, [(rng() - 0.5) * L * 0.6, 0, (rng() - 0.5) * L * 0.6], dir, perp, Ls, Ls * 0.2, SPIKE);
          }
        }
        const leafTone = (pal: typeof SAGE_COLOURS) => {
          let col = mix(pal.leafShade, pal.leafLit, inner ? shade * 0.7 : shade);
          // In flower the upper mass is a lavender haze, not grey: bloom
          // seen through bloom. The mass also sits a step into shadow.
          if (inner) col = mix(col, pal.bloomLit, 0.5 * smooth(0.15, 0.6, u)).map((v) => v * 0.9);
          return rgb(col);
        };
        const spikeTone = (pal: typeof SAGE_COLOURS) => {
          const col = mix(pal.bloomShade, pal.bloomLit, shade);
          return rgb(pale ? mix(col, pal.bloomPale, 0.5) : col);
        };
        tufts.push({
          c,
          leaves: new Float32Array(leaves),
          spikes: new Float32Array(spikes),
          inner,
          leafCol: [leafTone(SAGE_COLOURS), leafTone(SAGE_GOLD)],
          spikeCol: [spikeTone(SAGE_COLOURS), spikeTone(SAGE_GOLD)],
        });
      }
      return tufts;
    }

    /** Texas sage, after the app's model.
     *
     *  Not the hopseed's column: a low dome sitting right on the soil, no
     *  stems showing, wider than it is tall, its outline broken all over by
     *  short upright spikes of lavender bloom. Under the flowers, the soft
     *  woolly silver leaves that are the plant the rest of the year, showing
     *  most toward the bottom where the bloom thins out.
     *
     *  Drawn as tufts over the dome — a few small oval silver leaves, and on
     *  most of them two or three slim bloom spikes rising out of the leaves —
     *  over a mass of soft clumps of foliage a step into shadow, lavender
     *  where it's in flower, which makes it a solid mound rather than a
     *  cloud. Far first.
     *  Every tuft takes its colour from where it sits against the sheet's
     *  light (the boulder's), some flowers paler where they've opened.
     *  Leaves and spikes are drawn larger than life, as the hopseed's are.
     *
     *  Same economy as the hopseed: grown once and cached, four projections
     *  per tuft, the mass fill-only, and the core one filled silhouette.
     */
    function drawTexasSageBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}`;
      let tufts = sageGrown.get(key);
      if (!tufts) {
        if (sageGrown.size > 400) sageGrown.clear(); // growth and edits mint new keys
        tufts = growTexasSage(x, z, h, rw, seed);
        sageGrown.set(key, tufts);
      }
      const order = tufts.map((t) => {
        const [cx, cy, cz] = t.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { t, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      // A sage is a dense mound, not an airy column like the hopseed: from
      // the front, the leaves facing you never quite cover the skin they sit
      // on, and scattered at random they left sand showing through the
      // middle. So the core is filled solid first — set back inside the
      // tufts, which always break its edge, so it never reads as a shape.
      const core = convexHull(sageCoreRing(x, z, h, rw).map((v): [number, number] => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      }));
      if (core.length > 2) {
        ctx!.beginPath();
        ctx!.moveTo(core[0][0], core[0][1]);
        for (let i = 1; i < core.length; i++) ctx!.lineTo(core[i][0], core[i][1]);
        ctx!.closePath();
        const c = sel ? SAGE_GOLD.core : SAGE_COLOURS.core;
        ctx!.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx!.fill();
      }

      const g = sel ? 1 : 0;
      ctx!.lineJoin = "round";
      ctx!.lineWidth = lw * 0.45;
      ctx!.strokeStyle = sel ? gold(0.6) : ink(0.4);
      const shapes = (pts: Float32Array, corners: number, q: number[], J: number[]) => {
        ctx!.beginPath();
        for (let o = 0; o < pts.length; o += corners * 3) {
          for (let k = 0; k < corners; k++) {
            const i = o + k * 3;
            const sx = q[0] + J[0] * pts[i] + J[2] * pts[i + 1] + J[4] * pts[i + 2];
            const sy = q[1] + J[1] * pts[i] + J[3] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(sx, sy);
            else ctx!.moveTo(sx, sy);
          }
          ctx!.closePath();
        }
      };
      for (const { t, q, J } of order) {
        shapes(t.leaves, 8, q, J);
        ctx!.fillStyle = t.leafCol[g];
        ctx!.fill();
        if (t.inner) continue; // an outline on a tuft in shadow is noise
        ctx!.stroke();
        if (t.spikes.length) {
          shapes(t.spikes, 7, q, J);
          ctx!.fillStyle = t.spikeCol[g];
          ctx!.fill();
          ctx!.stroke();
        }
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the hopseed and sage are.
    type YellowBellsPart = {
      c: [number, number, number];
      /** outward normal, to skip outlines on the far side */
      n: [number, number, number];
      /** shapes as offsets from c, xyz; `corners` points each */
      pts: Float32Array;
      corners: number;
      kind: "inner" | "leaf" | "bloom";
      col: [string, string]; // [plain, gold]
    };
    const yellowBellsGrown = new Map<string, { stems: [number, number, number][][]; parts: YellowBellsPart[] }>();

    function growYellowBells(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
      const rng = rngFor("yellowbells:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const crs = (a: V3, b: V3): V3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      // An upright oval: bare stems only for the first few inches, the
      // foliage widening to full by a third of the way up, straight-sided,
      // then rounding over the top quarter.
      const prof = (u: number) =>
        (0.7 + 0.3 * smooth(0.07, 0.32, u)) *
        (u > 0.72 ? Math.pow(Math.max(0, 1 - ((u - 0.72) / 0.28) ** 2), 0.45) : 1);

      const stems: V3[][] = [];
      for (let k = 0; k < 6; k++) {
        const a = rot + k * 2.399963 + rng() * 0.6;
        const out = rw * (0.22 + 0.16 * rng());
        stems.push([
          [x + Math.cos(a) * rw * 0.05, 0, z + Math.sin(a) * rw * 0.05],
          [x + Math.cos(a) * out, h * (0.28 + 0.1 * rng()), z + Math.sin(a) * out],
        ]);
      }

      // Leaflets are broad ovals, toothed in life but too small for it to
      // show; trumpets flare from a narrow tube to an open mouth.
      const LEAFLET: [number, number][] = [[0, 0], [0.25, 0.42], [0.65, 0.45], [1, 0], [0.65, -0.45], [0.25, -0.42]];
      const TRUMPET: [number, number][] = [[0, -0.16], [0.5, -0.24], [0.78, -0.55], [0.96, -0.72], [1.06, 0], [0.96, 0.72], [0.78, 0.55], [0.5, 0.24], [0, 0.16]];
      const put = (out: number[], base: V3, dir: V3, perp: V3, len: number, wid: number, shape: [number, number][]) => {
        for (const [f, q] of shape) {
          for (let i = 0; i < 3; i++) out.push(base[i] + dir[i] * len * f + perp[i] * wid * q);
        }
      };

      const parts: YellowBellsPart[] = [];
      const NI = 190;
      const NS = 300;
      const NB = 40;
      const s1 = rng() * 6.28;
      for (let tries = 0; parts.length < NI + NS + NB && tries < (NI + NS + NB) * 4; tries++) {
        const i = parts.length;
        const kind: YellowBellsPart["kind"] = i < NI ? "inner" : i < NI + NS ? "leaf" : "bloom";
        // Flowers sit on the upper two thirds, at the tips of the outer shoots.
        const u = kind === "bloom" ? 0.25 + 0.73 * Math.sqrt(rng()) : 0.07 + 0.91 * rng();
        // By area: the straight sides follow the radius; the rounded crown,
        // like the sage's dome, has as much skin per foot at the top.
        if (u < 0.72 && rng() > prof(u)) continue;
        const th = rng() * Math.PI * 2;
        const tuft = 1 + 0.06 * Math.sin(5 * th + 8 * u + s1);
        const reach = kind === "inner" ? 0.62 + 0.2 * rng() : kind === "leaf" ? 0.9 + 0.12 * rng() : 1.0 + 0.1 * rng();
        const r = rw * prof(u) * reach * tuft;
        const c: V3 = [x + Math.cos(th) * r, Math.min(u * h, h * 0.98), z + Math.sin(th) * r];
        const n = nrm([Math.cos(th) * prof(u), (u - 0.45) * 1.2, Math.sin(th) * prof(u)]);
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        const shade = (0.3 + 0.7 * lit) * (0.5 + 0.5 * smooth(0.08, 0.75, u));
        const side = nrm(crs([0, 1, 0], n[1] > 0.98 ? [1, 0, 0] : n));
        const pts: number[] = [];
        if (kind === "bloom") {
          // A bunch of trumpets hanging together off one tip — out and
          // down, a little splayed. Fanned all the way round they read as a
          // propeller, which is nothing yellow bells ever does.
          // Each trumpet hangs from its own place along a short stalk; all
          // from one point they overlapped into a single yellow fan.
          const nt = 4 + Math.floor(rng() * 3);
          const L = rw * 0.12;
          const stalk = nrm([n[0] * 0.7, 0.55, n[2] * 0.7]);
          for (let k = 0; k < nt; k++) {
            const along = (k / (nt - 1)) * rw * 0.22;
            const sg = k % 2 ? 1 : -1;
            const dir = nrm([
              n[0] * 0.5 + side[0] * sg * (0.45 + 0.3 * rng()),
              n[1] * 0.4 - 0.6 + (rng() - 0.5) * 0.3,
              n[2] * 0.5 + side[2] * sg * (0.45 + 0.3 * rng()),
            ]);
            const perp = nrm(crs(dir, n[1] > 0.98 ? [1, 0, 0] : n));
            put(pts, [stalk[0] * along, stalk[1] * along, stalk[2] * along], dir, perp, L * (0.85 + 0.3 * rng()), L * 0.46, TRUMPET);
          }
          const tone = (pal: typeof YELLOW_BELLS_COLOURS) => rgb(mix(pal.bloomShade, pal.bloomLit, 0.35 + 0.65 * shade));
          parts.push({ c, n, pts: new Float32Array(pts), corners: TRUMPET.length, kind, col: [tone(YELLOW_BELLS_COLOURS), tone(YELLOW_BELLS_GOLD)] });
          continue;
        }
        // A compound leaf: a short rachis out and up, two pairs of leaflets
        // and one at the end.
        const rach = nrm([n[0] * 0.75 + (rng() - 0.5) * 0.3, 0.45 + (rng() - 0.5) * 0.3, n[2] * 0.75 + (rng() - 0.5) * 0.3]);
        const rs = nrm(crs(rach, n[1] > 0.98 ? [1, 0, 0] : n));
        const Ll = rw * (kind === "inner" ? 0.16 : 0.115) * (0.85 + 0.3 * rng());
        const len = rw * 0.2;
        [[0.35, 1], [0.35, -1], [0.7, 1], [0.7, -1], [1, 0]].forEach(([t, sg]) => {
          const base: V3 = [rach[0] * len * t, rach[1] * len * t, rach[2] * len * t];
          const k = sg === 0 ? 0 : 0.82;
          const dir = nrm([rach[0] * (1 - k * 0.5) + rs[0] * sg * k, rach[1] * (1 - k * 0.5) + rs[1] * sg * k - 0.1, rach[2] * (1 - k * 0.5) + rs[2] * sg * k]);
          const perp = nrm(crs(dir, n));
          put(pts, base, dir, perp, Ll, Ll * 0.48, LEAFLET);
        });
        const tone = (pal: typeof YELLOW_BELLS_COLOURS) => {
          const col = mix(pal.leafShade, pal.leafLit, shade);
          return rgb(kind === "inner" ? mix(pal.core, col, 0.4) : col);
        };
        parts.push({ c, n, pts: new Float32Array(pts), corners: LEAFLET.length, kind, col: [tone(YELLOW_BELLS_COLOURS), tone(YELLOW_BELLS_GOLD)] });
      }
      return { stems, parts };
    }

    /** Yellow bells ('Sundance'), after the app's model.
     *
     *  An upright oval, a third again as tall as it is wide: a handful of
     *  thin dark stems out of a tight base, then dense deep-green foliage —
     *  compound leaves of broad oval leaflets, nothing like the hopseed's
     *  willow blades — with clusters of golden trumpets scattered over the
     *  outside, thickest toward the top and on shoots standing proud of it.
     *
     *  Drawn as the stems; a deep inner layer of leaves in shade, which is
     *  what you see through the gaps (a filled core behind them showed as a
     *  smooth green pillar — this is a leafy shrub, nearer the hopseed than
     *  the sage); the outer leaves; and the trumpet clusters, each trumpet
     *  hanging from its own place on a short stalk. All sorted far first and
     *  lit by where they sit against the sheet's light. Grown once and
     *  cached; four projections a part.
     */
    function drawYellowBellsBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = yellowBellsGrown.get(key);
      if (!grown) {
        if (yellowBellsGrown.size > 400) yellowBellsGrown.clear(); // growth and edits mint new keys
        grown = growYellowBells(x, z, h, rw, rot, seed);
        yellowBellsGrown.set(key, grown);
      }
      ctx!.strokeStyle = sel ? gold(0.8) : "rgba(78,62,48,0.9)";
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.1), lw * 0.8);
      ctx!.lineCap = "round";
      for (const [a, b] of grown.stems) {
        const p0 = P(a[0], a[1], a[2]);
        const p1 = P(b[0], b[1], b[2]);
        ctx!.beginPath();
        ctx!.moveTo(p0[0], p0[1]);
        ctx!.lineTo(p1[0], p1[1]);
        ctx!.stroke();
      }
      ctx!.lineCap = "butt";

      const order = grown.parts.map((pt) => {
        const [cx, cy, cz] = pt.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { pt, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      const g = sel ? 1 : 0;
      // Built once a frame and only assigned when they change: a fresh
      // colour string on every part is re-parsed by the canvas each time,
      // and that doubled what the plant cost.
      const leafEdge = sel ? gold(0.6) : ink(0.4);
      const bloomEdge = sel ? gold(0.8) : "rgba(112,72,12,0.85)";
      let edge = "";
      ctx!.lineJoin = "round";
      ctx!.lineWidth = lw * 0.45;
      for (const { pt, q, J } of order) {
        const pts = pt.pts;
        const n = pt.corners;
        ctx!.beginPath();
        for (let o = 0; o < pts.length; o += n * 3) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const sx = q[0] + J[0] * pts[i] + J[2] * pts[i + 1] + J[4] * pts[i + 2];
            const sy = q[1] + J[1] * pts[i] + J[3] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(sx, sy);
            else ctx!.moveTo(sx, sy);
          }
          ctx!.closePath();
        }
        ctx!.fillStyle = pt.col[g];
        ctx!.fill();
        if (pt.kind === "inner") continue; // an outline on a leaf in shadow is noise
        // Nor on the far side: those leaves are under the near ones, and
        // outlining them was a third of the plant's cost for nothing seen.
        if (pt.n[0] * (eye[0] - pt.c[0]) + pt.n[1] * (eye[1] - pt.c[1]) + pt.n[2] * (eye[2] - pt.c[2]) < 0) continue;
        const want = pt.kind === "bloom" ? bloomEdge : leafEdge;
        if (want !== edge) {
          ctx!.strokeStyle = want;
          edge = want;
        }
        ctx!.stroke();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the other shrubs are.
    type RedBirdPart = {
      c: [number, number, number];
      /** shapes as offsets from c, xyz; `corners` points each */
      pts: Float32Array;
      corners: number;
      /** for blooms: stamen strokes, pairs of offsets from c */
      lines?: Float32Array;
      kind: "inner" | "frond" | "bloom" | "stalk";
      col: [string, string]; // [plain, gold]
    };
    const redBirdGrown = new Map<string, { stems: [number, number, number][][]; parts: RedBirdPart[] }>();

    function growRedBird(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
      const rng = rngFor("redbird:" + seed);
      const LX = -0.44;
      const LZ = -0.43;
      const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      // An open vase: narrow where the stems leave the ground, opening out
      // to full spread by a little over half its height and staying there —
      // the top is flat, tiers of fronds rather than a dome.
      const prof = (u: number) => (0.12 + 0.88 * smooth(0.04, 0.6, u)) * (u > 0.92 ? 1 - 0.35 * (u - 0.92) / 0.08 : 1);

      const stems: V3[][] = [];
      for (let k = 0; k < 9; k++) {
        const a = rot + k * 2.399963 + rng() * 0.5;
        const reach = rw * (0.3 + 0.3 * rng());
        stems.push([
          [x + Math.cos(a) * rw * 0.04, 0, z + Math.sin(a) * rw * 0.04],
          [x + Math.cos(a) * reach, h * (0.5 + 0.2 * rng()), z + Math.sin(a) * reach],
        ]);
      }

      // A frond seen flat: a narrow feathery spray, its outline finely
      // scalloped by the small round leaflets along it. Broad and coarsely
      // toothed, the first ones read as a different plant's leaves; the fern
      // texture is in the fineness. Corners along (1, 0), width on the
      // second axis.
      const FROND: [number, number][] = (() => {
        const out: [number, number][] = [];
        const S = 15;
        const w = (i: number) => Math.pow(Math.sin(Math.PI * Math.min(1, (i / S) * 1.04)), 0.5) * (i % 2 ? 1 : 0.5);
        for (let i = 0; i <= S; i++) out.push([i / S, w(i)]);
        for (let i = S - 1; i >= 1; i--) out.push([i / S, -w(i)]);
        return out;
      })();
      // A ruffled bloom, face on: five broad rounded petals, not a star.
      const BLOOM: [number, number][] = Array.from({ length: 15 }, (_, i): [number, number] => {
        const a = (i / 15) * Math.PI * 2;
        const r = i % 3 === 0 ? 0.78 : 1;
        return [0.5 + 0.5 * r * Math.cos(a), 0.5 * r * Math.sin(a) * 2];
      });

      const parts: RedBirdPart[] = [];
      const NI = 140;
      const NF = 320;
      const NB = 30;
      for (let tries = 0; parts.length < NI + NF + NB && tries < (NI + NF + NB) * 4; tries++) {
        const i = parts.length;
        const kind = i < NI ? "inner" : i < NI + NF ? "frond" : "bloom";
        if (kind !== "bloom") {
          // Fronds sit in tiers from a third of the way up to the top,
          // weighted to the broad upper canopy.
          const u = 0.3 + 0.68 * Math.sqrt(rng());
          const th = rng() * Math.PI * 2;
          const reach = kind === "inner" ? 0.25 + 0.4 * rng() : 0.55 + 0.45 * rng();
          const r = rw * prof(u) * reach;
          const c: V3 = [x + Math.cos(th) * r, u * h, z + Math.sin(th) * r];
          // Held out nearly level, along the way it grows, the tip dipping.
          const a = th + (rng() - 0.5) * 0.9;
          const dir: V3 = [Math.cos(a), -0.12 - 0.12 * rng(), Math.sin(a)];
          const dl = Math.hypot(...dir);
          const d: V3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
          const perp: V3 = [-Math.sin(a), 0, Math.cos(a)];
          const L = rw * 0.24 * (0.8 + 0.4 * rng()) * (kind === "inner" ? 0.85 : 1);
          const W = L * 0.12;
          const pts: number[] = [];
          for (const [f, q] of FROND) {
            for (let k = 0; k < 3; k++) pts.push(d[k] * L * (f - 0.35) + perp[k] * W * q);
          }
          // Lit from the light's side, darker low and toward the middle.
          const side = Math.max(0, Math.cos(th) * -LX + Math.sin(th) * -LZ);
          const shade = (0.45 + 0.35 * (1 - side) + 0.2 * rng()) * (0.55 + 0.45 * smooth(0.3, 0.95, u)) * (0.75 + 0.25 * reach);
          const tone = (pal: typeof RED_BIRD_COLOURS) =>
            rgb(kind === "inner" ? mix(pal.deep, pal.leafShade, 0.5 * shade) : mix(pal.leafShade, pal.leafLit, Math.min(1, shade)));
          parts.push({ c, pts: new Float32Array(pts), corners: FROND.length, kind, col: [tone(RED_BIRD_COLOURS), tone(RED_BIRD_GOLD)] });
          continue;
        }
        // A flower stalk rising out of the canopy, carrying its blooms up
        // it, each with a few long stamens arching out of it.
        const th = rng() * Math.PI * 2;
        const r = rw * (0.25 + 0.7 * Math.sqrt(rng()));
        // Mostly rising out of the top; some from the canopy's edge.
        const base: V3 = [x + Math.cos(th) * r, h * (r > rw * 0.75 ? 0.55 + 0.2 * rng() : 0.72 + 0.2 * rng()), z + Math.sin(th) * r];
        const up = h * (0.12 + 0.12 * rng());
        const lean = 0.25 * (rng() - 0.5);
        const tip: V3 = [base[0] + Math.cos(th) * up * 0.25 + lean, base[1] + up, base[2] + Math.sin(th) * up * 0.25];
        parts.push({
          c: base,
          pts: new Float32Array([0, 0, 0, tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]]),
          corners: 2,
          kind: "stalk",
          col: [RED_BIRD_COLOURS.stem, RED_BIRD_GOLD.stem],
        });
        const nb = 3 + Math.floor(rng() * 3);
        for (let b = 0; b < nb; b++) {
          const t = 0.35 + (0.6 * b) / Math.max(1, nb - 1);
          const c: V3 = [base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t, base[2] + (tip[2] - base[2]) * t];
          const fa = th + (rng() - 0.5) * 2.4; // which way the bloom faces
          const face: V3 = [Math.cos(fa), 0.3, Math.sin(fa)];
          const across: V3 = [-Math.sin(fa), 0, Math.cos(fa)];
          const s = rw * 0.055 * (0.8 + 0.4 * rng());
          const pts: number[] = [];
          for (const [f, q] of BLOOM) {
            for (let k = 0; k < 3; k++) pts.push(across[k] * s * (f - 0.5) * 2 + [0, 1, 0][k] * s * q * 0.9 + face[k] * s * 0.1);
          }
          const lines: number[] = [];
          for (let k = 0; k < 3; k++) {
            const sa = fa + (k - 1) * 0.35;
            const len = s * (2.2 + 0.8 * rng());
            lines.push(0, 0, 0, Math.cos(sa) * len, len * (0.35 + 0.3 * rng()), Math.sin(sa) * len);
          }
          const tone = (pal: typeof RED_BIRD_COLOURS) => rgb(mix(pal.bloomShade, pal.bloomLit, 0.5 + 0.5 * rng()));
          parts.push({ c, pts: new Float32Array(pts), corners: BLOOM.length, lines: new Float32Array(lines), kind: "bloom", col: [tone(RED_BIRD_COLOURS), tone(RED_BIRD_GOLD)] });
        }
      }
      return { stems, parts };
    }

    /** Red bird of paradise, after the app's model.
     *
     *  Nothing like the other shrubs' masses: an open vase of thin pale
     *  stems from a narrow base, carrying fine, feathery fronds held out
     *  nearly level in tiers out to a broad, flat top — the layering is the
     *  plant. Above it, loose clusters of ruffled scarlet blooms edged in
     *  gold rise on thin stalks, long red stamens arching out of them.
     *
     *  Drawn as the stems; fronds as long scalloped sprays laid nearly flat,
     *  the ones deep in the canopy darker; then the flower stalks and their
     *  blooms with stamens — all sorted far first. No core: this is the
     *  airiest shrub in the catalog, and you should see through its layers.
     *  Grown once and cached; four projections a part, styles set once a
     *  frame.
     */
    function drawRedBirdBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = redBirdGrown.get(key);
      if (!grown) {
        if (redBirdGrown.size > 400) redBirdGrown.clear(); // growth and edits mint new keys
        grown = growRedBird(x, z, h, rw, rot, seed);
        redBirdGrown.set(key, grown);
      }
      const pal = sel ? RED_BIRD_GOLD : RED_BIRD_COLOURS;

      ctx!.strokeStyle = pal.stem;
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.08), lw * 0.7);
      ctx!.lineCap = "round";
      for (const [a, b] of grown.stems) {
        const p0 = P(a[0], a[1], a[2]);
        const p1 = P(b[0], b[1], b[2]);
        ctx!.beginPath();
        ctx!.moveTo(p0[0], p0[1]);
        ctx!.lineTo(p1[0], p1[1]);
        ctx!.stroke();
      }

      const order = grown.parts.map((pt) => {
        const [cx, cy, cz] = pt.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { pt, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      const g = sel ? 1 : 0;
      const leafEdge = sel ? gold(0.6) : ink(0.4);
      const stalkW = Math.max(ftPx(x, z, 0.03), 0.8);
      let edge = "";
      const setEdge = (c: string) => {
        if (c !== edge) {
          ctx!.strokeStyle = c;
          edge = c;
        }
      };
      ctx!.lineJoin = "round";
      for (const { pt, q, J } of order) {
        const pts = pt.pts;
        const at = (i: number): [number, number] => [
          q[0] + J[0] * pts[i] + J[2] * pts[i + 1] + J[4] * pts[i + 2],
          q[1] + J[1] * pts[i] + J[3] * pts[i + 1] + J[5] * pts[i + 2],
        ];
        if (pt.kind === "stalk") {
          const b = at(3);
          ctx!.beginPath();
          ctx!.moveTo(q[0], q[1]);
          ctx!.lineTo(b[0], b[1]);
          ctx!.lineWidth = stalkW;
          setEdge(pt.col[g]);
          ctx!.stroke();
          continue;
        }
        ctx!.beginPath();
        for (let k = 0; k < pt.corners; k++) {
          const [sx, sy] = at(k * 3);
          if (k) ctx!.lineTo(sx, sy);
          else ctx!.moveTo(sx, sy);
        }
        ctx!.closePath();
        ctx!.fillStyle = pt.col[g];
        ctx!.fill();
        if (pt.kind === "inner") continue; // an outline on a frond in shadow is noise
        ctx!.lineWidth = lw * 0.45;
        setEdge(pt.kind === "bloom" ? pal.edge : leafEdge);
        ctx!.stroke();
        if (pt.lines) {
          const ln = pt.lines;
          ctx!.beginPath();
          for (let o = 0; o < ln.length; o += 6) {
            const [sx, sy] = [
              q[0] + J[0] * ln[o + 3] + J[2] * ln[o + 4] + J[4] * ln[o + 5],
              q[1] + J[1] * ln[o + 3] + J[3] * ln[o + 4] + J[5] * ln[o + 5],
            ];
            ctx!.moveTo(q[0], q[1]);
            ctx!.lineTo(sx, sy);
          }
          ctx!.lineWidth = Math.max(lw * 0.4, 0.6);
          setEdge(pal.stamen);
          ctx!.stroke();
        }
      }
      ctx!.lineCap = "butt";
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the shrubs before it are.
    type JojobaSprig = {
      c: [number, number, number];
      /** outward normal, to skip outlines on the far side */
      n: [number, number, number];
      /** the twig's tip, as an offset from c */
      tip: [number, number, number];
      /** leaf corners as offsets from c, xyz; JOJOBA_LEAF.length each */
      leaves: Float32Array;
      inner: boolean;
      col: [string, string]; // [plain, gold]
    };
    // The mound: foliage down to the soil, near-straight sides from a foot
    // up, a broad rounded crown. Radius (a fraction of rw) by height, the
    // mass's own height being 0.88 of the plant's — twigs make up the rest.
    const jojobaProf = (u: number) => {
      const t = Math.min(1, u / 0.15);
      const base = 0.78 + 0.22 * t * t * (3 - 2 * t);
      return u > 0.6 ? base * Math.sqrt(Math.max(0, 1 - ((u - 0.6) / 0.36) ** 2)) : base;
    };
    // A blunt oval, half as wide as it is long.
    const JOJOBA_LEAF: [number, number][] = [[0, 0], [0.3, 0.48], [0.75, 0.42], [1, 0], [0.75, -0.42], [0.3, -0.48]];
    const jojobaGrown = new Map<string, { stems: [number, number, number][][]; sprigs: JojobaSprig[] }>();
    // Its core: the mound set back from the leaves, filled as one silhouette.
    const jojobaCoreRing = (x: number, z: number, h: number, rw: number): [number, number, number][] => {
      const out: [number, number, number][] = [];
      for (let i = 0; i <= 8; i++) {
        const u = 0.06 + (0.86 * i) / 8;
        const r = rw * 0.7 * jojobaProf(u);
        for (let j = 0; j < 12; j++) {
          const th = (j / 12) * Math.PI * 2;
          out.push([x + Math.cos(th) * r, u * h * 0.88, z + Math.sin(th) * r]);
        }
      }
      return out;
    };

    function growJojoba(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
      const rng = rngFor("jojoba:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const crs = (a: V3, b: V3): V3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];

      // Many stems from the root crown, fanning up and out into the mound:
      // the dark lines seen through it low down.
      const stems: V3[][] = [];
      for (let k = 0; k < 9; k++) {
        const a = rot + k * 2.399963 + rng() * 0.5;
        const out = rw * (0.35 + 0.2 * rng());
        stems.push([
          [x + Math.cos(a) * rw * 0.06, 0, z + Math.sin(a) * rw * 0.06],
          [x + Math.cos(a) * out, h * (0.25 + 0.15 * rng()), z + Math.sin(a) * out],
        ]);
      }

      const sprigs: JojobaSprig[] = [];
      const NI = 140;
      const NS = 340;
      const s1 = rng() * 6.28;
      const s2 = rng() * 6.28;
      for (let tries = 0; sprigs.length < NI + NS && tries < (NI + NS) * 4; tries++) {
        const inner = sprigs.length < NI;
        const u = 0.02 + 0.94 * rng();
        // By area, as the sage: the sides follow the radius, the crown
        // doesn't.
        if (u < 0.6 && rng() > jojobaProf(u)) continue;
        const th = rng() * Math.PI * 2;
        // A few broad lobes round it and over the top — the model's mound
        // is lumpy, not a dome.
        const lobe = Math.sin(3 * th + s1);
        const lump = 1 + 0.06 * lobe + 0.04 * Math.sin(5 * th + 3 * u + s2);
        const pr = jojobaProf(u);
        const r = rw * pr * (inner ? 0.66 + 0.2 * rng() : 0.93 + 0.1 * rng()) * lump;
        const c: V3 = [x + Math.cos(th) * r, u * h * 0.88 * (1 + 0.04 * lobe), z + Math.sin(th) * r];
        const ny = u > 0.55 ? ((u - 0.55) / 0.41) * 2.5 : u < 0.12 ? -(0.12 - u) * 4 : 0;
        const n = nrm([Math.cos(th) * pr, ny, Math.sin(th) * pr]);
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        const shade = (0.38 + 0.62 * lit) * (0.6 + 0.4 * smooth(0, 0.6, u));

        // A twig mostly up, leaning out and to either side — jojoba's twigs
        // are upright, and pointing straight out they were end-on to the
        // camera, each a small rosette with the core showing round it. At
        // the foot they flare out over the soil. A third of those up the
        // sides and over the top stand proud of the mound — the model's
        // ragged, twiggy outline.
        const up = 0.15 + 0.55 * smooth(0, 0.15, u) + 0.3 * smooth(0.2, 0.7, u);
        const tw = (rng() - 0.5) * 0.9;
        const d = nrm([
          n[0] * 0.6 - Math.sin(th) * tw,
          up + n[1] * 0.3 + (rng() - 0.5) * 0.3,
          n[2] * 0.6 + Math.cos(th) * tw,
        ]);
        const proud = !inner && rng() < (u > 0.3 ? 0.35 : 0.15);
        const Ls = rw * (inner ? 0.24 : 0.17) * (0.8 + 0.4 * rng()) * (proud ? 1.9 : 1);
        const s0 = nrm(crs([0, 1, 0], Math.abs(d[1]) > 0.98 ? [Math.cos(th), 0, Math.sin(th)] : d));
        const b = nrm(crs(d, s0));
        // Drawn larger than life, as every shrub here is: at true size the
        // leaves covered under half the mound and it read as a dark ball.
        const L = rw * (inner ? 0.14 : 0.095) * (0.85 + 0.3 * rng());
        const pts: number[] = [];
        const put = (base: V3, dir: V3, len: number, flat: boolean) => {
          const dy = dir[1];
          const perp: V3 = flat || Math.abs(dy) > 0.95 ? s0 : nrm([-dir[0] * dy, 1 - dy * dy, -dir[2] * dy]);
          for (const [f, q] of JOJOBA_LEAF) {
            for (let i = 0; i < 3; i++) pts.push(base[i] + dir[i] * len * f + perp[i] * len * 0.52 * q);
          }
        };
        // Opposite pairs up the twig, each pair a quarter turn from the
        // last, and a young leaf at the tip. The pairs out to the sides
        // stand on edge, as jojoba holds its leaves to the sun; the pairs
        // above and below the twig lie across it — on edge too, they lay in
        // the twig's own upright plane, end-on to anyone looking at the
        // shrub, and the mound went thin.
        [0.35, 0.62, 0.86].forEach((t, k) => {
          const s = k % 2 ? b : s0;
          const base: V3 = [d[0] * Ls * t, d[1] * Ls * t, d[2] * Ls * t];
          for (const sg of [1, -1]) {
            const a = 0.85 + (rng() - 0.5) * 0.3;
            const ca = Math.cos(a);
            const sa = Math.sin(a) * sg;
            put(base, nrm([d[0] * ca + s[0] * sa, d[1] * ca + s[1] * sa, d[2] * ca + s[2] * sa]), L, k % 2 === 1);
          }
        });
        put([d[0] * Ls * 0.9, d[1] * Ls * 0.9, d[2] * Ls * 0.9], d, L * 0.75, true);

        // Mottled, as the scan is: every sprig a shade lighter or darker.
        const mottle = 0.92 + 0.16 * rng();
        const tone = (pal: typeof JOJOBA_COLOURS) => {
          const col = mix(pal.leafShade, pal.leafLit, shade).map((v) => Math.min(255, v * mottle));
          return rgb(inner ? mix(pal.core, col, 0.6) : col);
        };
        sprigs.push({
          c,
          n,
          tip: [d[0] * Ls, d[1] * Ls, d[2] * Ls],
          leaves: new Float32Array(pts),
          inner,
          col: [tone(JOJOBA_COLOURS), tone(JOJOBA_GOLD)],
        });
      }
      return { stems, sprigs };
    }

    /** Jojoba, after the app's model.
     *
     *  A broad, lumpy mound a third again as wide as it is tall, leafy right
     *  down to the soil, its sides near straight and its crown rounded — and
     *  its outline broken all round by twigs standing out of it. Not the
     *  sage's smooth dome: dull grey-green, no flowers, and leaves held the
     *  way only jojoba holds them — small blunt ovals in opposite pairs up
     *  short twigs, turned edge-on to the sun, so from the side you see their
     *  faces and from above, their edges.
     *
     *  Drawn as a set-back core (it's dense, like the sage, and leaves alone
     *  left sand showing through the middle); the stems and twigs, under
     *  every leaf, so what shows of them is through the gaps and at the
     *  bare base of a twig standing proud; a deep layer of sprigs in shadow,
     *  fill only; and the outer sprigs — far first, each lit by where it
     *  sits against the sheet's light and mottled a little, as the scan is.
     *  Grown once and cached; four projections a sprig, styles set once a
     *  frame.
     */
    function drawJojobaBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = jojobaGrown.get(key);
      if (!grown) {
        if (jojobaGrown.size > 400) jojobaGrown.clear(); // growth and edits mint new keys
        grown = growJojoba(x, z, h, rw, rot, seed);
        jojobaGrown.set(key, grown);
      }
      const pal = sel ? JOJOBA_GOLD : JOJOBA_COLOURS;

      const core = convexHull(jojobaCoreRing(x, z, h, rw).map((v): [number, number] => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      }));
      if (core.length > 2) {
        ctx!.beginPath();
        ctx!.moveTo(core[0][0], core[0][1]);
        for (let i = 1; i < core.length; i++) ctx!.lineTo(core[i][0], core[i][1]);
        ctx!.closePath();
        ctx!.fillStyle = `rgb(${pal.core[0]},${pal.core[1]},${pal.core[2]})`;
        ctx!.fill();
      }

      const order = grown.sprigs.map((sp) => {
        const [cx, cy, cz] = sp.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { sp, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      ctx!.strokeStyle = pal.stem;
      ctx!.lineCap = "round";
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.045), lw * 0.5);
      ctx!.beginPath();
      for (const [a, b] of grown.stems) {
        const p0 = P(a[0], a[1], a[2]);
        const p1 = P(b[0], b[1], b[2]);
        ctx!.moveTo(p0[0], p0[1]);
        ctx!.lineTo(p1[0], p1[1]);
      }
      ctx!.stroke();
      ctx!.strokeStyle = pal.twig;
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.025), lw * 0.4);
      ctx!.beginPath();
      for (const { sp, q, J } of order) {
        if (sp.inner) continue;
        const [tx, ty, tz] = sp.tip;
        ctx!.moveTo(q[0], q[1]);
        ctx!.lineTo(q[0] + J[0] * tx + J[2] * ty + J[4] * tz, q[1] + J[1] * tx + J[3] * ty + J[5] * tz);
      }
      ctx!.stroke();
      ctx!.lineCap = "butt";

      const g = sel ? 1 : 0;
      const n = JOJOBA_LEAF.length;
      ctx!.lineJoin = "round";
      ctx!.lineWidth = lw * 0.45;
      ctx!.strokeStyle = sel ? gold(0.6) : ink(0.4);
      for (const { sp, q, J } of order) {
        const pts = sp.leaves;
        ctx!.beginPath();
        for (let o = 0; o < pts.length; o += n * 3) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const sx = q[0] + J[0] * pts[i] + J[2] * pts[i + 1] + J[4] * pts[i + 2];
            const sy = q[1] + J[1] * pts[i] + J[3] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(sx, sy);
            else ctx!.moveTo(sx, sy);
          }
          ctx!.closePath();
        }
        ctx!.fillStyle = sp.col[g];
        ctx!.fill();
        if (sp.inner) continue; // an outline on a sprig in shadow is noise
        if (sp.n[0] * (eye[0] - sp.c[0]) + sp.n[1] * (eye[1] - sp.c[1]) + sp.n[2] * (eye[2] - sp.c[2]) < 0) continue;
        ctx!.stroke();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the shrubs before it are.
    type BottlebrushPart = {
      c: [number, number, number];
      /** outward normal, to skip outlines on the far side */
      n: [number, number, number];
      /** leaf corners as offsets from c, xyz; BOTTLEBRUSH_LEAF.length each.
       *  For a brush, its axis — two points, offsets from c — then a
       *  [place along it, lean, side] triple per stamen. */
      pts: Float32Array;
      kind: "inner" | "leaf" | "tip" | "brush";
      col: [string, string]; // [plain, gold]
    };
    // A needle: narrow, pointed both ends.
    const BOTTLEBRUSH_LEAF: [number, number][] = [[0, 0], [0.45, 0.5], [1, 0], [0.45, -0.5]];
    const bottlebrushGrown = new Map<string, { arms: [number, number, number][][]; parts: BottlebrushPart[] }>();
    // The heart of the mound, set back behind the inner needles.
    const bottlebrushCoreRing = (x: number, z: number, h: number, rw: number): [number, number, number][] => {
      const out: [number, number, number][] = [];
      for (let i = 0; i <= 6; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / 6;
        const r = rw * 0.38 * Math.cos(a);
        const y = h * (0.3 + 0.18 * Math.sin(a));
        for (let j = 0; j < 12; j++) {
          const th = (j / 12) * Math.PI * 2;
          out.push([x + Math.cos(th) * r, y, z + Math.sin(th) * r]);
        }
      }
      return out;
    };

    function growBottlebrush(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
      const rng = rngFor("bottlebrush:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const crs = (a: V3, b: V3): V3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      const outward = (c: V3): V3 => nrm([c[0] - x, ((c[1] - h * 0.25) * rw) / h, c[2] - z]);
      const shadeAt = (c: V3, n: V3) => {
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        return (0.35 + 0.65 * lit) * (0.6 + 0.4 * smooth(0, 0.8, c[1] / h));
      };
      const parts: BottlebrushPart[] = [];
      // A whorl of needles round a stretch of shoot, swept forward along it.
      const whorl = (c: V3, dir: V3, k: number, L: number, sweep: number, spin: number) => {
        const s0 = nrm(crs(dir, Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
        const s1 = crs(dir, s0);
        const pts: number[] = [];
        const cs = Math.cos(sweep);
        const sn = Math.sin(sweep);
        for (let i = 0; i < k; i++) {
          const a = spin + (i / k) * Math.PI * 2;
          const rad: V3 = [s0[0] * Math.cos(a) + s1[0] * Math.sin(a), s0[1] * Math.cos(a) + s1[1] * Math.sin(a), s0[2] * Math.cos(a) + s1[2] * Math.sin(a)];
          const d: V3 = [dir[0] * cs + rad[0] * sn, dir[1] * cs + rad[1] * sn, dir[2] * cs + rad[2] * sn];
          // The blade's width lies round the shoot, so a whorl reads as a
          // bristling cylinder from any side.
          const w: V3 = crs(d, rad);
          for (const [f, q] of BOTTLEBRUSH_LEAF) {
            for (let j = 0; j < 3; j++) pts.push(d[j] * L * f + w[j] * L * 0.28 * q);
          }
        }
        return new Float32Array(pts);
      };

      // Arms: stiff shoots fanning out of a tight base, the long ones low and
      // reaching the rim halfway up, the short ones nearly upright to the
      // top — the model's fan, widest at mid-height, not a dome. A little
      // shorter across the plant's yaw than along it, as the model is.
      const arms: V3[][] = [];
      const NA = 24;
      for (let k = 0; k < NA; k++) {
        const a = rot + k * 2.399963 + (rng() - 0.5) * 0.4;
        const reach = (0.3 + 0.75 * Math.sqrt(rng())) * (1 - 0.19 * Math.sin(a - rot) ** 2);
        const rt = rw * Math.min(1.02, reach);
        const yt = h * Math.min(1, (1 - 0.48 * (rt / rw) ** 2) * (0.88 + 0.14 * rng()));
        const p0: V3 = [x + Math.cos(a) * rw * 0.06, h * 0.06, z + Math.sin(a) * rw * 0.06];
        // Nearly straight out of the base, curling up a little at the end.
        const p1: V3 = [x + Math.cos(a) * rt * 0.55, yt * 0.44, z + Math.sin(a) * rt * 0.55];
        const p2: V3 = [x + Math.cos(a) * rt, yt, z + Math.sin(a) * rt];
        const at = (t: number): V3 => {
          const u = 1 - t;
          return [0, 1, 2].map((i) => u * u * p0[i] + 2 * u * t * p1[i] + t * t * p2[i]) as V3;
        };
        const path: V3[] = [];
        for (let i = 0; i <= 8; i++) path.push(at(i / 8));
        arms.push(path);
        // Needles from a quarter of the way out — inside that the shoot is in
        // the mound — in close whorls, so each shoot is a thick bristling
        // cylinder as the model's are (sparse, they read as rosemary), to a
        // clubbed tip of paler new growth.
        const len = Math.hypot(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
        const nW = Math.max(5, Math.round(len / (rw * 0.06)));
        const L = rw * 0.16 * (0.9 + 0.2 * rng());
        for (let i = 0; i < nW; i++) {
          const t = 0.25 + (0.75 * (i + 0.5)) / nW;
          const c = at(t);
          const c2 = at(Math.min(1, t + 0.02));
          const dir = nrm([c2[0] - c[0], c2[1] - c[1], c2[2] - c[2]]);
          const tip = t > 0.88;
          const n = outward(c);
          const shade = shadeAt(c, n);
          const pts = whorl(c, dir, 9, L * (tip ? 0.8 : 1), tip ? 0.45 : 0.85, rng() * 6.28);
          const tone = (pal: typeof BOTTLEBRUSH_COLOURS) => {
            const col = mix(pal.leafShade, pal.leafLit, shade);
            return rgb(tip ? mix(col, pal.tip, 0.65) : col);
          };
          parts.push({ c, n, pts, kind: tip ? "tip" : "leaf", col: [tone(BOTTLEBRUSH_COLOURS), tone(BOTTLEBRUSH_GOLD)] });
        }
        // A crimson brush on some shoots, just behind the leafy tip — the
        // shoot grows on through the flower, as a bottlebrush's does.
        if (rng() < 0.38) {
          const t0 = 0.66 + 0.08 * rng();
          const a0 = at(t0);
          const a1 = at(t0 + 0.17);
          const c: V3 = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2, (a0[2] + a1[2]) / 2];
          const pts = [a0[0] - c[0], a0[1] - c[1], a0[2] - c[2], a1[0] - c[0], a1[1] - c[1], a1[2] - c[2]];
          for (let i = 0; i < 32; i++) pts.push((i + 0.5) / 32, (rng() - 0.5) * 0.9, i % 2 ? 1 : -1);
          parts.push({ c, n: outward(c), pts: new Float32Array(pts), kind: "brush", col: ["", ""] });
        }
      }

      // The mound's heart: big whorls in shade round the base of the arms,
      // fill only.
      for (let i = 0; i < 140; i++) {
        const th = rng() * Math.PI * 2;
        const v = rng() * 2 - 1;
        const r = rw * 0.46 * Math.sqrt(1 - v * v) * (0.85 + 0.2 * rng());
        const c: V3 = [x + Math.cos(th) * r, h * (0.3 + 0.22 * v), z + Math.sin(th) * r];
        const n = outward(c);
        const dir = nrm([n[0] * 0.6 + (rng() - 0.5) * 0.6, 0.7, n[2] * 0.6 + (rng() - 0.5) * 0.6]);
        const shade = shadeAt(c, n);
        // Smaller than the shoots' own needles would suggest: big, they
        // read as agave spikes at the foot of the plant.
        const pts = whorl(c, dir, 7, rw * 0.13, 0.75, rng() * 6.28);
        const tone = (pal: typeof BOTTLEBRUSH_COLOURS) => rgb(mix(pal.core, mix(pal.leafShade, pal.leafLit, shade), 0.55));
        parts.push({ c, n, pts, kind: "inner", col: [tone(BOTTLEBRUSH_COLOURS), tone(BOTTLEBRUSH_GOLD)] });
      }
      return { arms, parts };
    }

    /** Little John bottlebrush, after the app's model.
     *
     *  Not a mound of leaves like the jojoba or the sage: a fan of stiff
     *  shoots out of a tight base, each one bristling all the way round
     *  with short needle leaves — a bottlebrush of foliage — and clubbed at
     *  the end with paler new growth. The long shoots splay out low and
     *  reach the rim halfway up; the short ones stand nearly upright to the
     *  top, so the plant is widest at mid-height with open sky between its
     *  arms. Dark blue-green, and here and there on the shoots, just behind
     *  the tip, the crimson brush it's named for. The scan was taken out of
     *  flower; the brushes are what say "bottlebrush" from across a yard.
     *
     *  Drawn as the shoots themselves, under everything; a set-back core and
     *  a layer of big shaded whorls for the dense heart of the plant; then
     *  the whorls up every shoot and the brushes, far first, each lit by
     *  where it sits against the sheet's light. A brush is a cylinder, so
     *  it's drawn the way a cylinder looks from anywhere: a dark round-capped
     *  stroke down its axis, and stamens bristling out either side of it,
     *  across the axis as it lies on screen — drawn smooth, it was a red
     *  pill. Grown once and cached; four projections a part, styles set once
     *  a frame.
     */
    function drawBottlebrushBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = bottlebrushGrown.get(key);
      if (!grown) {
        if (bottlebrushGrown.size > 400) bottlebrushGrown.clear(); // growth and edits mint new keys
        grown = growBottlebrush(x, z, h, rw, rot, seed);
        bottlebrushGrown.set(key, grown);
      }
      const pal = sel ? BOTTLEBRUSH_GOLD : BOTTLEBRUSH_COLOURS;

      const core = convexHull(bottlebrushCoreRing(x, z, h, rw).map((v): [number, number] => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      }));
      if (core.length > 2) {
        ctx!.beginPath();
        ctx!.moveTo(core[0][0], core[0][1]);
        for (let i = 1; i < core.length; i++) ctx!.lineTo(core[i][0], core[i][1]);
        ctx!.closePath();
        ctx!.fillStyle = `rgb(${pal.core[0]},${pal.core[1]},${pal.core[2]})`;
        ctx!.fill();
      }

      // The shoots, under every needle: what shows of them is their bare
      // bases and the stretches between whorls.
      ctx!.strokeStyle = pal.stem;
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.05), lw * 0.6);
      ctx!.beginPath();
      for (const path of grown.arms) {
        for (let i = 0; i < path.length; i++) {
          const q = P(path[i][0], path[i][1], path[i][2]);
          if (i) ctx!.lineTo(q[0], q[1]);
          else ctx!.moveTo(q[0], q[1]);
        }
      }
      ctx!.stroke();

      const order = grown.parts.map((pt) => {
        const [cx, cy, cz] = pt.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { pt, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      const g = sel ? 1 : 0;
      const n = BOTTLEBRUSH_LEAF.length;
      const leafEdge = sel ? gold(0.6) : ink(0.4);
      // Larger than life, as the needles are, or they vanish at plan zoom.
      const brushW = Math.max(ftPx(x, z, 0.1), lw);
      const stamenL = Math.max(ftPx(x, z, 0.12), 2.5);
      const stamenW = Math.max(ftPx(x, z, 0.016), 0.8);
      const leafW = lw * 0.45;
      ctx!.lineWidth = leafW;
      ctx!.strokeStyle = leafEdge;
      for (const { pt, q, J } of order) {
        const pts = pt.pts;
        if (pt.kind === "brush") {
          const ax = q[0] + J[0] * pts[0] + J[2] * pts[1] + J[4] * pts[2];
          const ay = q[1] + J[1] * pts[0] + J[3] * pts[1] + J[5] * pts[2];
          const bx = q[0] + J[0] * pts[3] + J[2] * pts[4] + J[4] * pts[5];
          const by = q[1] + J[1] * pts[3] + J[3] * pts[4] + J[5] * pts[5];
          ctx!.lineCap = "round";
          ctx!.beginPath();
          ctx!.moveTo(ax, ay);
          ctx!.lineTo(bx, by);
          ctx!.lineWidth = brushW;
          ctx!.strokeStyle = pal.brush;
          ctx!.stroke();
          const dx = bx - ax;
          const dy = by - ay;
          const dl = Math.hypot(dx, dy) || 1;
          const ux = dx / dl;
          const uy = dy / dl;
          ctx!.beginPath();
          for (let o = 6; o < pts.length; o += 3) {
            const sx = ax + dx * pts[o];
            const sy = ay + dy * pts[o];
            const lean = pts[o + 1];
            const side = pts[o + 2];
            const ex = (-uy * side + ux * lean) * stamenL;
            const ey = (ux * side + uy * lean) * stamenL;
            ctx!.moveTo(sx, sy);
            ctx!.lineTo(sx + ex, sy + ey);
          }
          ctx!.lineWidth = stamenW;
          ctx!.strokeStyle = pal.stamen;
          ctx!.stroke();
          ctx!.lineCap = "butt";
          ctx!.lineWidth = leafW;
          ctx!.strokeStyle = leafEdge;
          continue;
        }
        ctx!.beginPath();
        for (let o = 0; o < pts.length; o += n * 3) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const sx = q[0] + J[0] * pts[i] + J[2] * pts[i + 1] + J[4] * pts[i + 2];
            const sy = q[1] + J[1] * pts[i] + J[3] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(sx, sy);
            else ctx!.moveTo(sx, sy);
          }
          ctx!.closePath();
        }
        ctx!.fillStyle = pt.col[g];
        ctx!.fill();
        if (pt.kind === "inner") continue; // an outline on a whorl in shadow is noise
        if (pt.n[0] * (eye[0] - pt.c[0]) + pt.n[1] * (eye[1] - pt.c[1]) + pt.n[2] * (eye[2] - pt.c[2]) < 0) continue;
        ctx!.stroke();
      }
      ctx!.lineCap = "butt";
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the shrubs are.
    type PaloVerdeTree = {
      /** limbs by order — trunk, main limbs, branches, twigs, fine twigs — as segments */
      limbs: [number, number, number][][][];
      /** canopy lobes: centre, then its two radii (across, up) */
      lobes: { c: [number, number, number]; rx: number; ry: number; col: [string, string] }[];
      /** leaf flecks, grouped by tone — 0 (deep shade) to PV_LEVELS - 1,
       *  then the flowers — each as the lobe it sits in, its offset from
       *  that lobe's centre (xyz), and its slant */
      fleckLobe: Uint16Array;
      fleckOff: Float32Array;
      fleckSlant: Float32Array;
      /** where each tone's flecks start; the flowers' group is PV_LEVELS */
      groupStart: Int32Array;
    };
    // Flecks take one of a few tones, so all of one tone fill in a single
    // pass — a canopy is a thousand of them.
    const PV_LEVELS = 8;
    const pvTones = (pal: typeof PALO_VERDE_COLOURS) =>
      Array.from({ length: PV_LEVELS }, (_, i) => {
        const t = i / (PV_LEVELS - 1);
        return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
      });
    const PV_TONES = [pvTones(PALO_VERDE_COLOURS), pvTones(PALO_VERDE_GOLD)];
    const paloVerdeGrown = new Map<string, PaloVerdeTree>();

    function growPaloVerde(x: number, z: number, h: number, rw: number, rot: number, seed: string): PaloVerdeTree {
      const rng = rngFor("paloverde:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const lightOf = (n: V3) => Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
      // The canopy's skin: a broad dome on a drooping rim — widest a little
      // above halfway, its edge down to a third of the height, as the model.
      const y0 = h * 0.55;
      const shell = (th: number, ph: number): V3 => [
        x + rw * Math.cos(ph) * Math.cos(th),
        y0 + Math.sin(ph) * (ph > 0 ? h * 0.45 : h * 0.6),
        z + rw * Math.cos(ph) * Math.sin(th),
      ];
      const outward = (c: V3): V3 => nrm([(c[0] - x) / rw, ((c[1] - y0) / h) * 1.4, (c[2] - z) / rw]);

      // One trunk, forking a fifth of the way up into a vase of limbs, each
      // forking twice more out to the canopy's skin, every twig ending in a
      // fan of fine ones.
      const trunk: V3[][] = [];
      const mains: V3[][] = [];
      const branches: V3[][] = [];
      const twigs: V3[][] = [];
      const fine: V3[][] = [];
      const clusters: V3[][] = []; // each branch's twig ends
      const lean = rng() * 6.28;
      const F: V3 = [x + Math.cos(lean) * rw * 0.03, h * 0.2, z + Math.sin(lean) * rw * 0.03];
      trunk.push([[x, 0, z], F]);
      const NM = 7;
      for (let k = 0; k < NM; k++) {
        const a = rot + (k / NM) * Math.PI * 2 + (rng() - 0.5) * 0.5;
        const o1 = rw * (0.24 + 0.12 * rng());
        const P1: V3 = [F[0] + Math.cos(a) * o1, h * (0.38 + 0.08 * rng()), F[2] + Math.sin(a) * o1];
        mains.push([F, P1]);
        for (let j = 0; j < 3; j++) {
          const a2 = a + (j - 1) * 0.45 + (rng() - 0.5) * 0.3;
          const out = rw * (j === 1 ? 0.16 : 0.24) * (0.8 + 0.4 * rng());
          const P2: V3 = [P1[0] + Math.cos(a2) * out, h * (j === 1 ? 0.64 : 0.54) * (0.95 + 0.1 * rng()), P1[2] + Math.sin(a2) * out];
          branches.push([P1, P2]);
          const ends: V3[] = [];
          for (let i = 0; i < 3; i++) {
            const th = a2 + (rng() - 0.5) * 0.7;
            // Out to the skin, anywhere from the drooping rim to the crown;
            // the middle branch of each fork reaches higher.
            const ph = -0.35 + (Math.PI / 2 + 0.35) * Math.pow(rng(), j === 1 ? 0.6 : 1.3) * 0.95;
            const P3 = lerp(P2, shell(th, ph), 0.88 + 0.1 * rng());
            twigs.push([P2, P3]);
            ends.push(P3);
            const td = nrm([P3[0] - P2[0], P3[1] - P2[1], P3[2] - P2[2]]);
            for (let f = 0; f < 5; f++) {
              const A = lerp(P2, P3, 0.35 + 0.65 * rng());
              const fd = nrm([td[0] * 0.6 + (rng() - 0.5) * 0.9, td[1] * 0.6 + 0.45 + (rng() - 0.5) * 0.4, td[2] * 0.6 + (rng() - 0.5) * 0.9]);
              const fl = rw * 0.12 * (0.6 + 0.6 * rng());
              fine.push([A, [A[0] + fd[0] * fl, A[1] + fd[1] * fl, A[2] + fd[2] * fl]]);
            }
          }
          clusters.push([P2, ...ends]);
        }
      }

      // A lobe of foliage round each branch's spray of twigs, drawn
      // translucent: where lobes overlap the crown thickens, at its edges
      // it thins to air, and the limbs show through it dimmed — as the
      // model's mist does.
      // Two to a branch, one in and one out, so they run together into one
      // lumpy dome; none hangs below the drooping rim, or the crown grows a
      // skirt round the trunk.
      const lobes: PaloVerdeTree["lobes"] = [];
      // Each lobe is itself three overlapping puffs, fainter, so its edge is
      // lumpy as foliage is — one clean ellipse apiece made cartoon clouds.
      const alpha = 0.23;
      for (const [P2, ...ends] of clusters) {
        const m: V3 = [0, 0, 0];
        for (const e of ends) for (let i = 0; i < 3; i++) m[i] += e[i] / ends.length;
        for (const t of [0.55, 0.95]) {
          const c = lerp(P2, m, t);
          c[0] += (rng() - 0.5) * rw * 0.06;
          c[2] += (rng() - 0.5) * rw * 0.06;
          let spread = 0;
          for (const e of ends) spread = Math.max(spread, Math.hypot(e[0] - c[0], e[2] - c[2]));
          const rx = Math.max(rw * 0.22, spread * 0.9) * (0.85 + 0.25 * rng());
          const ry = Math.max(rx * 0.3, Math.min(rx * 0.6, c[1] - h * 0.32));
          for (let k = 0; k < 3; k++) {
            const pc: V3 = [c[0] + (rng() - 0.5) * rx * 0.8, c[1] + (rng() - 0.5) * ry * 0.6, c[2] + (rng() - 0.5) * rx * 0.8];
            const s = (0.45 + 0.55 * lightOf(outward(pc))) * 0.85 + 0.15;
            const tone = (pal: typeof PALO_VERDE_COLOURS) =>
              `rgba(${pal.shade.map((v, i) => (v + (pal.lit[i] - v) * s) | 0).join(",")},${alpha})`;
            lobes.push({ c: pc, rx: rx * (0.6 + 0.15 * rng()), ry: ry * (0.65 + 0.15 * rng()), col: [tone(PALO_VERDE_COLOURS), tone(PALO_VERDE_GOLD)] });
          }
        }
      }

      // Flecks of tiny leaves through the lobes, thickest toward their
      // skins; a few, out at the canopy's edge, yellow bloom. Each is kept
      // as an offset in its lobe, so it's placed by the lobe's projection
      // rather than projected itself — a thousand projections a tree was
      // most of what a small tree cost.
      const NF = 1500;
      const raw: { li: number; o: V3; slant: number; group: number }[] = [];
      for (let i = 0; i < NF; i++) {
        const li = Math.floor(rng() * lobes.length);
        const L = lobes[li];
        const v = nrm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
        const r = Math.pow(rng(), 0.4);
        const o: V3 = [v[0] * L.rx * r, v[1] * L.ry * r, v[2] * L.rx * r];
        const c: V3 = [L.c[0] + o[0], L.c[1] + o[1], L.c[2] + o[2]];
        const n = outward(c);
        const e = Math.hypot((c[0] - x) / rw, (c[1] - y0) / (h * 0.5), (c[2] - z) / rw);
        const shade = (0.3 + 0.7 * lightOf(nrm([n[0] + v[0], n[1] + v[1], n[2] + v[2]]))) * (0.55 + 0.45 * smooth(0.4, 1, e)) * (0.9 + 0.2 * rng());
        const level = Math.max(0, Math.min(PV_LEVELS - 1, Math.round(shade * (PV_LEVELS - 1))));
        raw.push({ li, o, slant: rng() * Math.PI, group: e > 0.8 && rng() < 0.12 ? PV_LEVELS : level });
      }
      raw.sort((a, b) => a.group - b.group);
      const fleckLobe = new Uint16Array(NF);
      const fleckOff = new Float32Array(NF * 3);
      const fleckSlant = new Float32Array(NF);
      const groupStart = new Int32Array(PV_LEVELS + 2).fill(NF);
      raw.forEach((f, i) => {
        fleckLobe[i] = f.li;
        fleckOff.set(f.o, i * 3);
        fleckSlant[i] = f.slant;
        if (groupStart[f.group] === NF) groupStart[f.group] = i;
      });
      // A group with no flecks starts where the next one does.
      for (let gi = PV_LEVELS; gi >= 0; gi--) groupStart[gi] = Math.min(groupStart[gi], groupStart[gi + 1]);
      return { limbs: [trunk, mains, branches, twigs, fine], lobes, fleckLobe, fleckOff, fleckSlant, groupStart };
    }

    /** Blue palo verde, after the app's model.
     *
     *  Not a canopy disc: one short pale trunk, forking a fifth of the way
     *  up into a vase of limbs that fork twice more out to a broad dome,
     *  widest a little above halfway with its rim drooping to a third of
     *  the height — a tree a good deal wider than it is tall, its every twig
     *  ending in a fan of fine ones. The canopy is mostly air, a sage mist
     *  you see the limbs through, with a light scatter of yellow bloom near
     *  the outside, as the model has.
     *
     *  Drawn as the limbs by order, trunk to fine twig, each a single stroke
     *  of its own width; then a translucent lobe of foliage round each
     *  branch's twigs, far first, thickening the crown where they overlap
     *  and dimming the limbs behind them; then a thousand flecks of leaf,
     *  a tone at a time, and the flowers. Drawn leaf by leaf, as the shrubs
     *  are, it was either a scatter of confetti or three times the cost —
     *  a tree this size is seen as a texture, not as leaves. No solid core:
     *  this canopy is see-through, and a filled one would make it a lollipop.
     *  Grown once and cached.
     */
    function drawPaloVerdeBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = paloVerdeGrown.get(key);
      if (!grown) {
        if (paloVerdeGrown.size > 400) paloVerdeGrown.clear(); // growth and edits mint new keys
        grown = growPaloVerde(x, z, h, rw, rot, seed);
        paloVerdeGrown.set(key, grown);
      }
      const pal = sel ? PALO_VERDE_GOLD : PALO_VERDE_COLOURS;
      const g = sel ? 1 : 0;

      // Limbs, thickest first: trunk, main limbs, branches, twigs, fine twigs.
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      const widths = [0.9, 0.45, 0.22, 0.09, 0.04];
      const floors = [2.2, 1.5, 1, 0.6, 0.45];
      grown.limbs.forEach((segs, order) => {
        ctx!.strokeStyle = order === 0 ? pal.trunk : order < 3 ? pal.limb : pal.twig;
        ctx!.lineWidth = Math.max(ftPx(x, z, widths[order]), floors[order]);
        ctx!.beginPath();
        for (const [a, b] of segs) {
          const p0 = P(a[0], a[1], a[2]);
          const p1 = P(b[0], b[1], b[2]);
          ctx!.moveTo(p0[0], p0[1]);
          ctx!.lineTo(p1[0], p1[1]);
        }
        ctx!.stroke();
      });
      ctx!.lineCap = "butt";

      const proj = grown.lobes.map((L) => {
        const [cx, cy, cz] = L.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { L, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      const lobes = proj.slice().sort((a, b) => b.q[2] - a.q[2]); // far first
      for (const { L, q, J } of lobes) {
        // An ellipsoid seen through the camera's local (affine) map is an
        // ellipse: its axes from the 2×2 spread of the three mapped radii.
        const ax = [J[0] * L.rx, J[2] * L.ry, J[4] * L.rx];
        const ay = [J[1] * L.rx, J[3] * L.ry, J[5] * L.rx];
        const c11 = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
        const c22 = ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2];
        const c12 = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        ctx!.beginPath();
        ctx!.ellipse(q[0], q[1], Math.sqrt(mid + d), Math.sqrt(Math.max(0, mid - d)), 0.5 * Math.atan2(2 * c12, c11 - c22), 0, Math.PI * 2);
        ctx!.fillStyle = L.col[g];
        ctx!.fill();
      }

      // Flecks: a slanted dash of leaf each, a fixed size on the ground plan
      // at this spot, placed by its lobe's projection and filled a tone at a
      // time, then the flowers.
      const { fleckLobe, fleckOff, fleckSlant, groupStart } = grown;
      const half = Math.max(ftPx(x, z, 0.42), 1.4);
      const tones = PV_TONES[g];
      for (let gi = 0; gi <= PV_LEVELS; gi++) {
        const from = groupStart[gi];
        const to = groupStart[gi + 1];
        if (from >= to) continue;
        const s = gi === PV_LEVELS ? half * 0.8 : half;
        ctx!.fillStyle = gi === PV_LEVELS ? pal.bloom : tones[gi];
        ctx!.beginPath();
        for (let i = from; i < to; i++) {
          const { q, J } = proj[fleckLobe[i]];
          const ox = fleckOff[i * 3];
          const oy = fleckOff[i * 3 + 1];
          const oz = fleckOff[i * 3 + 2];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          const a = fleckSlant[i];
          const ux = Math.cos(a) * s;
          const uy = Math.sin(a) * s;
          ctx!.moveTo(px + ux, py + uy);
          ctx!.lineTo(px - uy * 0.45, py + ux * 0.45);
          ctx!.lineTo(px - ux, py - uy);
          ctx!.lineTo(px + uy * 0.45, py - ux * 0.45);
          ctx!.closePath();
        }
        ctx!.fillStyle = gi === PV_LEVELS ? pal.bloom : tones[gi];
        ctx!.fill();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per tree and kept, as the palo verde is.
    type MesquiteTree = {
      /** limbs by order — trunk, main limbs, branches, twigs — as segments */
      limbs: [number, number, number][][][];
      /** canopy puffs: centre, its two radii (across, up), and tone */
      lobes: { c: [number, number, number]; rx: number; ry: number; col: [string, string] }[];
      /** weeping strands: polylines of three points hanging off the canopy */
      strands: [number, number, number][][];
      /** leaf flecks and catkins, grouped by tone — 0 (deep shade) to
       *  MQ_LEVELS - 1, then the catkins — each as the puff it hangs from,
       *  its offset from that puff's centre (xyz), and its slant */
      fleckLobe: Uint16Array;
      fleckOff: Float32Array;
      fleckSlant: Float32Array;
      groupStart: Int32Array;
    };
    const MQ_LEVELS = 8;
    const mqTones = (pal: typeof MESQUITE_COLOURS) =>
      Array.from({ length: MQ_LEVELS }, (_, i) => {
        const t = i / (MQ_LEVELS - 1);
        return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
      });
    const MQ_TONES = [mqTones(MESQUITE_COLOURS), mqTones(MESQUITE_GOLD)];
    const mesquiteGrown = new Map<string, MesquiteTree>();

    function growMesquite(x: number, z: number, h: number, rw: number, rot: number, seed: string): MesquiteTree {
      const rng = rngFor("mesquite:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const lightOf = (n: V3) => Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
      // The crown: a broad, low dome — widest a third of the way up, where
      // the limbs spread — with a lobe or two standing above it, and its
      // edge weeping toward the ground.
      const y0 = h * 0.5;
      const shell = (th: number, ph: number): V3 => [
        x + rw * Math.cos(ph) * Math.cos(th),
        y0 + Math.sin(ph) * (ph > 0 ? h * 0.42 : h * 0.3),
        z + rw * Math.cos(ph) * Math.sin(th),
      ];
      const outward = (c: V3): V3 => nrm([(c[0] - x) / rw, ((c[1] - y0) / h) * 1.4, (c[2] - z) / rw]);

      // A short, stout trunk with a lean, forking low into a few big limbs
      // that run out nearly level and crook upward — a mesquite's limbs zig
      // and zag — then branch and twig out to the crown.
      const trunk: V3[][] = [];
      const mains: V3[][] = [];
      const branches: V3[][] = [];
      const twigs: V3[][] = [];
      const clusters: V3[][] = [];
      const lean = rng() * 6.28;
      const F: V3 = [x + Math.cos(lean) * rw * 0.06, h * 0.22, z + Math.sin(lean) * rw * 0.06];
      trunk.push([[x, 0, z], F]);
      const NM = 5;
      for (let k = 0; k < NM; k++) {
        const a = rot + (k / NM) * Math.PI * 2 + (rng() - 0.5) * 0.7;
        // Out nearly level, then a crook up.
        const K: V3 = [F[0] + Math.cos(a) * rw * (0.2 + 0.1 * rng()), h * (0.28 + 0.06 * rng()), F[2] + Math.sin(a) * rw * (0.2 + 0.1 * rng())];
        const ak = a + (rng() - 0.5) * 0.5;
        const P1: V3 = [K[0] + Math.cos(ak) * rw * (0.14 + 0.08 * rng()), h * (0.42 + 0.08 * rng()), K[2] + Math.sin(ak) * rw * (0.14 + 0.08 * rng())];
        mains.push([F, K], [K, P1]);
        for (let j = 0; j < 3; j++) {
          const a2 = ak + (j - 1) * 0.55 + (rng() - 0.5) * 0.3;
          const out = rw * (j === 1 ? 0.14 : 0.24) * (0.8 + 0.4 * rng());
          const P2: V3 = [P1[0] + Math.cos(a2) * out, h * (j === 1 ? 0.66 : 0.52) * (0.95 + 0.1 * rng()), P1[2] + Math.sin(a2) * out];
          branches.push([P1, P2]);
          const ends: V3[] = [];
          for (let i = 0; i < 3; i++) {
            const th = a2 + (rng() - 0.5) * 0.8;
            const ph = -0.5 + (Math.PI / 2 + 0.5) * Math.pow(rng(), j === 1 ? 0.55 : 1.2) * 0.95;
            // Ending inside the foliage: bare, they poked out of the crown
            // like straws.
            const P3 = lerp(P2, shell(th, ph), 0.76 + 0.1 * rng());
            twigs.push([P2, P3]);
            ends.push(P3);
          }
          clusters.push([P2, ...ends]);
        }
      }

      // Puffs of foliage round each branch's twigs — denser than the palo
      // verde's mist, as the model is: you see into this crown, not
      // through it — three to a lobe, two lobes to a branch.
      const lobes: MesquiteTree["lobes"] = [];
      const alpha = 0.3;
      for (const [P2, ...ends] of clusters) {
        const m: V3 = [0, 0, 0];
        for (const e of ends) for (let i = 0; i < 3; i++) m[i] += e[i] / ends.length;
        for (const t of [0.5, 0.92]) {
          const c = lerp(P2, m, t);
          let spread = 0;
          for (const e of ends) spread = Math.max(spread, Math.hypot(e[0] - c[0], e[2] - c[2]));
          const rx = Math.max(rw * 0.24, spread * 0.95) * (0.85 + 0.25 * rng());
          const ry = Math.max(rx * 0.35, Math.min(rx * 0.62, c[1] - h * 0.28));
          for (let k = 0; k < 3; k++) {
            const pc: V3 = [c[0] + (rng() - 0.5) * rx * 0.8, c[1] + (rng() - 0.5) * ry * 0.6, c[2] + (rng() - 0.5) * rx * 0.8];
            const sh = (0.4 + 0.6 * lightOf(outward(pc))) * 0.85 + 0.15;
            const tone = (pal: typeof MESQUITE_COLOURS) =>
              `rgba(${pal.shade.map((v, i) => (v + (pal.lit[i] - v) * sh) | 0).join(",")},${alpha})`;
            lobes.push({ c: pc, rx: rx * (0.6 + 0.15 * rng()), ry: ry * (0.65 + 0.15 * rng()), col: [tone(MESQUITE_COLOURS), tone(MESQUITE_GOLD)] });
          }
        }
      }

      // Weeping strands off the outer puffs: the drooping branchlets hang a
      // fifth of the height below the crown's edge, curving out then down.
      const strands: V3[][] = [];
      const strandOf: number[] = [];
      lobes.forEach((L, li) => {
        const out = Math.hypot(L.c[0] - x, L.c[2] - z) / rw;
        if (out < 0.45) return;
        const n = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          const a = rng() * 6.28;
          const A: V3 = [L.c[0] + Math.cos(a) * L.rx * 0.7, L.c[1] - L.ry * 0.4, L.c[2] + Math.sin(a) * L.rx * 0.7];
          const drop = h * (0.1 + 0.12 * rng()) * out;
          const ox = (A[0] - x) / (rw * out);
          const oz = (A[2] - z) / (rw * out);
          const B: V3 = [A[0] + ox * rw * 0.04, A[1] - drop * 0.5, A[2] + oz * rw * 0.04];
          const C: V3 = [B[0] + ox * rw * 0.015, Math.max(h * 0.12, A[1] - drop), B[2] + oz * rw * 0.015];
          strands.push([A, B, C]);
          strandOf.push(li);
        }
      });

      // Flecks: the leaflets, hanging — a mesquite's feathery leaves droop,
      // so the dashes mostly fall near-vertical — through the puffs and
      // down the strands; and pale catkins hanging among them. Each kept as
      // an offset in its puff, placed by the puff's projection.
      const raw: { li: number; o: V3; slant: number; group: number }[] = [];
      const fleckAt = (li: number, c: V3, v: V3, catkin: boolean) => {
        const L = lobes[li];
        const n = outward(c);
        const e = Math.hypot((c[0] - x) / rw, (c[1] - y0) / (h * 0.45), (c[2] - z) / rw);
        const sh = (0.3 + 0.7 * lightOf(nrm([n[0] + v[0], n[1] + v[1], n[2] + v[2]]))) * (0.55 + 0.45 * smooth(0.35, 1, e)) * (0.9 + 0.2 * rng());
        const level = Math.max(0, Math.min(MQ_LEVELS - 1, Math.round(sh * (MQ_LEVELS - 1))));
        raw.push({ li, o: [c[0] - L.c[0], c[1] - L.c[1], c[2] - L.c[2]], slant: Math.PI / 2 + (rng() - 0.5) * (catkin ? 0.25 : 0.9), group: catkin ? MQ_LEVELS : level });
      };
      for (let i = 0; i < 1000; i++) {
        const li = Math.floor(rng() * lobes.length);
        const L = lobes[li];
        const v = nrm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
        const r = Math.pow(rng(), 0.45);
        const c: V3 = [L.c[0] + v[0] * L.rx * r, L.c[1] + v[1] * L.ry * r, L.c[2] + v[2] * L.rx * r];
        const e = Math.hypot((c[0] - x) / rw, (c[1] - y0) / (h * 0.45), (c[2] - z) / rw);
        fleckAt(li, c, v, e > 0.7 && rng() < 0.06);
      }
      strands.forEach(([A, B, C], si) => {
        for (let k = 0; k < 3; k++) {
          const t = rng();
          const c = t < 0.5 ? lerp(A, B, t * 2) : lerp(B, C, t * 2 - 1);
          fleckAt(strandOf[si], c, nrm([c[0] - x, 0, c[2] - z]), false);
        }
      });
      raw.sort((a, b) => a.group - b.group);
      const NF = raw.length;
      const fleckLobe = new Uint16Array(NF);
      const fleckOff = new Float32Array(NF * 3);
      const fleckSlant = new Float32Array(NF);
      const groupStart = new Int32Array(MQ_LEVELS + 2).fill(NF);
      raw.forEach((f, i) => {
        fleckLobe[i] = f.li;
        fleckOff.set(f.o, i * 3);
        fleckSlant[i] = f.slant;
        if (groupStart[f.group] === NF) groupStart[f.group] = i;
      });
      for (let gi = MQ_LEVELS; gi >= 0; gi--) groupStart[gi] = Math.min(groupStart[gi], groupStart[gi + 1]);
      return { limbs: [trunk, mains, branches, twigs], lobes, strands, fleckLobe, fleckOff, fleckSlant, groupStart };
    }

    /** Honey mesquite, after the app's model.
     *
     *  Not the palo verde's misty vase: a short, stout, dark trunk with a
     *  lean, forking low into a few big rough limbs that run out nearly
     *  level and crook upward, under a broad, lumpy, low dome of fresh
     *  yellow-green that you see into rather than through — widest a third
     *  of the way up, a lobe or two standing above it — and its edge
     *  weeping: the feathery branchlets hang a fifth of the height below
     *  the crown, as a mesquite's do. Pale catkins hang among the leaves.
     *
     *  Drawn as the limbs by order, trunk to twig, each one stroke of its
     *  own width; then translucent puffs of foliage round each branch's
     *  twigs, far first; the weeping strands in one stroke; then the
     *  leaflets as near-vertical hanging dashes, a tone at a time, and the
     *  catkins. Grown once and cached; flecks placed by their puff's
     *  projection, as the palo verde's are.
     */
    function drawMesquiteBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = mesquiteGrown.get(key);
      if (!grown) {
        if (mesquiteGrown.size > 400) mesquiteGrown.clear(); // growth and edits mint new keys
        grown = growMesquite(x, z, h, rw, rot, seed);
        mesquiteGrown.set(key, grown);
      }
      const pal = sel ? MESQUITE_GOLD : MESQUITE_COLOURS;
      const g = sel ? 1 : 0;

      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      const widths = [1.5, 0.6, 0.28, 0.1];
      const floors = [2.6, 1.7, 1, 0.6];
      grown.limbs.forEach((segs, order) => {
        ctx!.strokeStyle = order === 0 ? pal.trunk : order < 3 ? pal.limb : pal.twig;
        ctx!.lineWidth = Math.max(ftPx(x, z, widths[order]), floors[order]);
        ctx!.beginPath();
        for (const [a, b] of segs) {
          const p0 = P(a[0], a[1], a[2]);
          const p1 = P(b[0], b[1], b[2]);
          ctx!.moveTo(p0[0], p0[1]);
          ctx!.lineTo(p1[0], p1[1]);
        }
        ctx!.stroke();
      });

      const proj = grown.lobes.map((L) => {
        const [cx, cy, cz] = L.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { L, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      for (const { L, q, J } of proj.slice().sort((a, b) => b.q[2] - a.q[2])) {
        // An ellipsoid through the local (affine) map is an ellipse.
        const ax = [J[0] * L.rx, J[2] * L.ry, J[4] * L.rx];
        const ay = [J[1] * L.rx, J[3] * L.ry, J[5] * L.rx];
        const c11 = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
        const c22 = ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2];
        const c12 = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        ctx!.beginPath();
        ctx!.ellipse(q[0], q[1], Math.sqrt(mid + d), Math.sqrt(Math.max(0, mid - d)), 0.5 * Math.atan2(2 * c12, c11 - c22), 0, Math.PI * 2);
        ctx!.fillStyle = L.col[g];
        ctx!.fill();
      }

      ctx!.strokeStyle = pal.strand;
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.06), 0.6);
      ctx!.beginPath();
      for (const [A, B, C] of grown.strands) {
        const a = P(A[0], A[1], A[2]);
        const b = P(B[0], B[1], B[2]);
        const c = P(C[0], C[1], C[2]);
        ctx!.moveTo(a[0], a[1]);
        ctx!.quadraticCurveTo(b[0], b[1], c[0], c[1]);
      }
      ctx!.stroke();
      ctx!.lineCap = "butt";

      const { fleckLobe, fleckOff, fleckSlant, groupStart } = grown;
      const half = Math.max(ftPx(x, z, 0.4), 1.4);
      const tones = MQ_TONES[g];
      for (let gi = 0; gi <= MQ_LEVELS; gi++) {
        const from = groupStart[gi];
        const to = groupStart[gi + 1];
        if (from >= to) continue;
        // Catkins are longer and thinner than the leaflets.
        const s = gi === MQ_LEVELS ? half * 1.3 : half;
        const wd = gi === MQ_LEVELS ? 0.25 : 0.4;
        ctx!.fillStyle = gi === MQ_LEVELS ? pal.bloom : tones[gi];
        ctx!.beginPath();
        for (let i = from; i < to; i++) {
          // Filled a hundred and fifty at a time: one path of a thousand
          // overlapping dashes cost five times as much to fill.
          if (i > from && (i - from) % 150 === 0) {
            ctx!.fill();
            ctx!.beginPath();
          }
          const { q, J } = proj[fleckLobe[i]];
          const ox = fleckOff[i * 3];
          const oy = fleckOff[i * 3 + 1];
          const oz = fleckOff[i * 3 + 2];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          const a = fleckSlant[i];
          const ux = Math.cos(a) * s;
          const uy = Math.sin(a) * s;
          ctx!.moveTo(px + ux, py + uy);
          ctx!.lineTo(px - uy * wd, py + ux * wd);
          ctx!.lineTo(px - ux, py - uy);
          ctx!.lineTo(px + uy * wd, py - ux * wd);
          ctx!.closePath();
        }
        ctx!.fill();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per tree and kept, as the other trees are.
    type EbonyTree = {
      /** trunk and the limbs it forks into, as segments */
      limbs: [number, number, number][][][];
      /** the crown's set-back shell, filled as one silhouette */
      coreRing: [number, number, number][];
      /** puffs over the crown's skin: centre, radii (across, up), outward
       *  normal, tone, and how far out its outline reaches at each of
       *  EB_PUFF points round it */
      puffs: { c: [number, number, number]; rx: number; ry: number; n: [number, number, number]; level: number; jit: Float32Array }[];
      /** leaflet flecks, grouped by tone — 0 to EB_LEVELS - 1, then the pods —
       *  each as its puff, its offset from that puff's centre, and its slant */
      fleckPuff: Uint16Array;
      fleckOff: Float32Array;
      fleckSlant: Float32Array;
      groupStart: Int32Array;
    };
    const EB_LEVELS = 6;
    const EB_PUFF = 9;
    const ebTones = (pal: typeof EBONY_COLOURS) =>
      Array.from({ length: EB_LEVELS }, (_, i) => {
        const t = i / (EB_LEVELS - 1);
        return `rgb(${pal.fleckShade.map((v, k) => (v + (pal.fleckLit[k] - v) * t) | 0).join(",")})`;
      });
    const EB_TONES = [ebTones(EBONY_COLOURS), ebTones(EBONY_GOLD)];
    // Puffs take one of a few tones too, so a band of them at one depth
    // fills a tone at a time — a crown is three hundred of them.
    const ebPuffTones = (pal: typeof EBONY_COLOURS) =>
      Array.from({ length: EB_LEVELS }, (_, i) => {
        const t = i / (EB_LEVELS - 1);
        return `rgba(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")},0.92)`;
      });
    const EB_PUFF_TONES = [ebPuffTones(EBONY_COLOURS), ebPuffTones(EBONY_GOLD)];
    const ebonyGrown = new Map<string, EbonyTree>();
    // The crown's radius (a fraction of rw) by height (a fraction of h): an
    // upright egg from a seventh of the way up, widest at three fifths, as
    // the model's is.
    const ebonyProf = (u: number) => {
      if (u < 0.13 || u > 1) return 0;
      if (u < 0.6) {
        const t = (u - 0.13) / 0.47;
        return 0.62 + 0.38 * Math.sin((t * Math.PI) / 2);
      }
      return Math.sqrt(Math.max(0, 1 - ((u - 0.6) / 0.4) ** 2));
    };

    function growEbony(x: number, z: number, h: number, rw: number, rot: number, seed: string): EbonyTree {
      const rng = rngFor("ebony:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const lightOf = (n: V3) => Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
      // Slightly longer one way than the other, as the model's crown is.
      const squash = (th: number) => 1 - 0.12 * Math.sin(th - rot) ** 2;
      const skinNormal = (th: number, u: number): V3 => {
        const d = (ebonyProf(Math.min(1, u + 0.02)) - ebonyProf(Math.max(0.13, u - 0.02))) / 0.04;
        return nrm([Math.cos(th) * h, -d * rw, Math.sin(th) * h].map((v, i) => (i === 1 ? v : v / h)) as V3);
      };

      // A short, stout, pale trunk forking a seventh of the way up into three
      // thick limbs that rise into the crown.
      const F: V3 = [x, h * 0.13, z];
      const trunk: V3[][] = [[[x, 0, z], F]];
      const mains: V3[][] = [];
      for (let k = 0; k < 3; k++) {
        const a = rot + (k / 3) * Math.PI * 2 + (rng() - 0.5) * 0.6;
        const r = rw * (0.18 + 0.1 * rng());
        mains.push([F, [x + Math.cos(a) * r, h * (0.32 + 0.08 * rng()), z + Math.sin(a) * r]]);
      }

      // Tapered at the foot, so its bottom edge stays inside the puffs.
      const coreRing: V3[] = [];
      for (let i = 0; i <= 8; i++) {
        const u = 0.2 + (0.76 * i) / 8;
        for (let j = 0; j < 12; j++) {
          const th = (j / 12) * Math.PI * 2;
          const r = rw * 0.8 * ebonyProf(u) * squash(th) * (0.7 + 0.3 * smooth(0.2, 0.32, u));
          coreRing.push([x + Math.cos(th) * r, u * h, z + Math.sin(th) * r]);
        }
      }

      // Puffs over the crown's skin, by area: they make its lumpy outline and
      // its light and shade; the core behind them means no sand shows
      // through a crown this dense.
      // Many small ones, of varied size and ragged outline: big, they read
      // as broccoli; round and alike, as cauliflower.
      const puffs: EbonyTree["puffs"] = [];
      const push = (c: V3, n: V3, u: number) => {
        const rx = rw * (0.1 + 0.08 * rng());
        const jit = new Float32Array(EB_PUFF);
        for (let k = 0; k < EB_PUFF; k++) jit[k] = 0.78 + 0.32 * rng();
        const sh = (0.3 + 0.7 * lightOf(n)) * (0.6 + 0.4 * smooth(0.15, 0.7, u)) * (0.9 + 0.2 * rng());
        const level = Math.max(0, Math.min(EB_LEVELS - 1, Math.round(sh * (EB_LEVELS - 1))));
        puffs.push({ c, rx, ry: rx * 0.8, n, level, jit });
      };
      for (let tries = 0; puffs.length < 300 && tries < 2000; tries++) {
        const u = 0.15 + 0.85 * rng();
        if (rng() > ebonyProf(u) && u < 0.6) continue;
        const th = rng() * Math.PI * 2;
        const r = rw * ebonyProf(u) * squash(th) * (0.86 + 0.1 * rng());
        push([x + Math.cos(th) * r, Math.min(u * h, h * 0.95), z + Math.sin(th) * r], skinNormal(th, u), u);
      }

      // Leaflet flecks on the puffs' outer faces — the model's bright green
      // speckle, brightest where the light falls — and a few brown pods.
      const raw: { pi: number; o: V3; slant: number; group: number }[] = [];
      for (let i = 0; i < 1200; i++) {
        const pi = Math.floor(rng() * puffs.length);
        const P0 = puffs[pi];
        const v = nrm([P0.n[0] + (rng() - 0.5) * 1.6, P0.n[1] + (rng() - 0.5) * 1.6, P0.n[2] + (rng() - 0.5) * 1.6]);
        const r = 0.55 + 0.45 * rng();
        const o: V3 = [v[0] * P0.rx * r, v[1] * P0.ry * r, v[2] * P0.rx * r];
        const lit = lightOf(nrm([P0.n[0] + v[0], P0.n[1] + v[1], P0.n[2] + v[2]]));
        const sh = (0.25 + 0.75 * lit) * (0.85 + 0.3 * rng());
        const level = Math.max(0, Math.min(EB_LEVELS - 1, Math.round(sh * (EB_LEVELS - 1))));
        raw.push({ pi, o, slant: rng() * Math.PI, group: rng() < 0.04 ? EB_LEVELS : level });
      }
      raw.sort((a, b) => a.group - b.group);
      const NF = raw.length;
      const fleckPuff = new Uint16Array(NF);
      const fleckOff = new Float32Array(NF * 3);
      const fleckSlant = new Float32Array(NF);
      const groupStart = new Int32Array(EB_LEVELS + 2).fill(NF);
      raw.forEach((f, i) => {
        fleckPuff[i] = f.pi;
        fleckOff.set(f.o, i * 3);
        fleckSlant[i] = f.group === EB_LEVELS ? Math.PI / 2 + (f.slant - Math.PI / 2) * 0.3 : f.slant;
        if (groupStart[f.group] === NF) groupStart[f.group] = i;
      });
      for (let gi = EB_LEVELS; gi >= 0; gi--) groupStart[gi] = Math.min(groupStart[gi], groupStart[gi + 1]);
      return { limbs: [trunk, mains], coreRing, puffs, fleckPuff, fleckOff, fleckSlant, groupStart };
    }

    /** Texas ebony, after the app's model.
     *
     *  Nothing like the palo verde's mist or the mesquite's weeping dome: a
     *  dense, dark, upright egg of a crown — taller than wide, widest three
     *  fifths of the way up, starting low, a seventh of the way up a short,
     *  stout, pale trunk that forks into three thick limbs — so dense you
     *  see none of the tree inside it. Near-black green, lit by a speckle of
     *  small bright leaflets where the light falls, with brown pods hanging
     *  here and there.
     *
     *  Drawn as the trunk and limbs; the crown's shell set back and filled
     *  as one dark silhouette — like the sage, this is a dense plant, and
     *  without it the sand shows between the puffs; then near-opaque puffs
     *  over its skin, far first, for the lumpy outline and the light and
     *  shade; then the leaflet flecks a tone at a time, and the pods. Grown
     *  once and cached; flecks placed by their puff's projection.
     */
    function drawEbonyBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = ebonyGrown.get(key);
      if (!grown) {
        if (ebonyGrown.size > 400) ebonyGrown.clear(); // growth and edits mint new keys
        grown = growEbony(x, z, h, rw, rot, seed);
        ebonyGrown.set(key, grown);
      }
      const pal = sel ? EBONY_GOLD : EBONY_COLOURS;
      const g = sel ? 1 : 0;

      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      const widths = [1.6, 0.8];
      const floors = [2.6, 1.8];
      grown.limbs.forEach((segs, order) => {
        ctx!.strokeStyle = order === 0 ? pal.trunk : pal.limb;
        ctx!.lineWidth = Math.max(ftPx(x, z, widths[order]), floors[order]);
        ctx!.beginPath();
        for (const [a, b] of segs) {
          const p0 = P(a[0], a[1], a[2]);
          const p1 = P(b[0], b[1], b[2]);
          ctx!.moveTo(p0[0], p0[1]);
          ctx!.lineTo(p1[0], p1[1]);
        }
        ctx!.stroke();
      });
      ctx!.lineCap = "butt";

      const core = convexHull(grown.coreRing.map((v): [number, number] => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      }));
      if (core.length > 2) {
        ctx!.beginPath();
        ctx!.moveTo(core[0][0], core[0][1]);
        for (let i = 1; i < core.length; i++) ctx!.lineTo(core[i][0], core[i][1]);
        ctx!.closePath();
        ctx!.fillStyle = `rgb(${pal.core[0]},${pal.core[1]},${pal.core[2]})`;
        ctx!.fill();
      }

      const proj = grown.puffs.map((L) => {
        const [cx, cy, cz] = L.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { L, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      const sorted = proj.slice().sort((a, b) => b.q[2] - a.q[2]); // far first
      const puffTones = EB_PUFF_TONES[g];
      const trace = ({ L, q, J }: (typeof proj)[number]) => {
        // An ellipsoid through the local (affine) map is an ellipse.
        const ax = [J[0] * L.rx, J[2] * L.ry, J[4] * L.rx];
        const ay = [J[1] * L.rx, J[3] * L.ry, J[5] * L.rx];
        const c11 = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
        const c22 = ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2];
        const c12 = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        const ea = Math.sqrt(mid + d);
        const eb = Math.sqrt(Math.max(0, mid - d));
        const ang = 0.5 * Math.atan2(2 * c12, c11 - c22);
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        // Round that ellipse, each point pushed in or out by its own amount.
        for (let k = 0; k < EB_PUFF; k++) {
          const t = (k / EB_PUFF) * Math.PI * 2;
          const ex = Math.cos(t) * ea * L.jit[k];
          const ey = Math.sin(t) * eb * L.jit[k];
          const px = q[0] + ex * ca - ey * sa;
          const py = q[1] + ex * sa + ey * ca;
          if (k) ctx!.lineTo(px, py);
          else ctx!.moveTo(px, py);
        }
        ctx!.closePath();
      };
      // Far to near in a few bands, each band a tone at a time: puffs this
      // small barely overlap their neighbours in depth.
      const BANDS = 5;
      const byTone: (typeof proj)[] = Array.from({ length: EB_LEVELS }, () => []);
      for (let band = 0; band < BANDS; band++) {
        for (const list of byTone) list.length = 0;
        const from = Math.floor((sorted.length * band) / BANDS);
        const to = Math.floor((sorted.length * (band + 1)) / BANDS);
        for (let o = from; o < to; o++) byTone[sorted[o].L.level].push(sorted[o]);
        byTone.forEach((list, level) => {
          if (!list.length) return;
          ctx!.beginPath();
          for (const p of list) trace(p);
          ctx!.fillStyle = puffTones[level];
          ctx!.fill();
        });
      }

      // Flecks on the near side only: on the far side they'd be under the
      // near puffs anyway.
      const { fleckPuff, fleckOff, fleckSlant, groupStart } = grown;
      const half = Math.max(ftPx(x, z, 0.3), 1.2);
      const tones = EB_TONES[g];
      const puffs = grown.puffs;
      for (let gi = 0; gi <= EB_LEVELS; gi++) {
        const from = groupStart[gi];
        const to = groupStart[gi + 1];
        if (from >= to) continue;
        const pod = gi === EB_LEVELS;
        const s = pod ? half * 1.5 : half;
        const wd = pod ? 0.28 : 0.7;
        ctx!.fillStyle = pod ? pal.pod : tones[gi];
        ctx!.beginPath();
        for (let i = from; i < to; i++) {
          // Filled a hundred and fifty at a time, as the mesquite's are.
          if (i > from && (i - from) % 150 === 0) {
            ctx!.fill();
            ctx!.beginPath();
          }
          const pf = puffs[fleckPuff[i]];
          const ox = fleckOff[i * 3];
          const oy = fleckOff[i * 3 + 1];
          const oz = fleckOff[i * 3 + 2];
          const wx = pf.c[0] + ox;
          const wy = pf.c[1] + oy;
          const wz = pf.c[2] + oz;
          if ((wx - x) * (eye[0] - wx) + (wy - h * 0.55) * (eye[1] - wy) + (wz - z) * (eye[2] - wz) < 0) continue;
          const { q, J } = proj[fleckPuff[i]];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          const a = fleckSlant[i];
          const ux = Math.cos(a) * s;
          const uy = Math.sin(a) * s;
          ctx!.moveTo(px + ux, py + uy);
          ctx!.lineTo(px - uy * wd, py + ux * wd);
          ctx!.lineTo(px - ux, py - uy);
          ctx!.lineTo(px + uy * wd, py - ux * wd);
          ctx!.closePath();
        }
        ctx!.fill();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per tree and kept, as the other trees are.
    type MulgaTree = {
      /** limbs by order — trunk, leader, branches, twigs — as segments */
      limbs: [number, number, number][][][];
      /** canopy puffs: centre, radii (across, up), tone */
      lobes: { c: [number, number, number]; rx: number; ry: number; col: [string, string] }[];
      /** phyllode flecks, grouped by tone, each as its puff, its offset from
       *  that puff's centre, and its slant */
      fleckLobe: Uint16Array;
      fleckOff: Float32Array;
      fleckSlant: Float32Array;
      groupStart: Int32Array;
    };
    const MU_LEVELS = 7;
    const muTones = (pal: typeof MULGA_COLOURS) =>
      Array.from({ length: MU_LEVELS }, (_, i) => {
        const t = i / (MU_LEVELS - 1);
        return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
      });
    const MU_TONES = [muTones(MULGA_COLOURS), muTones(MULGA_GOLD)];
    const mulgaGrown = new Map<string, MulgaTree>();
    // The crown's radius (a fraction of rw) by height: widest low, where
    // the lower limbs spread, then tapering to a point — a narrow upright
    // cone over an oval, as the model is.
    const mulgaProf = (u: number) => {
      if (u < 0.2 || u > 1) return 0;
      if (u < 0.32) return 0.65 + 0.35 * Math.sin(((u - 0.2) / 0.12) * (Math.PI / 2));
      if (u < 0.5) return 1 - 0.22 * ((u - 0.32) / 0.18);
      return 0.78 * Math.sqrt(Math.max(0, 1 - ((u - 0.5) / 0.5) ** 1.6));
    };

    function growMulga(x: number, z: number, h: number, rw: number, rot: number, seed: string): MulgaTree {
      const rng = rngFor("mulga:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const lightOf = (n: V3) => Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
      const outward = (c: V3): V3 => nrm([(c[0] - x) / rw, ((c[1] - h * 0.5) / h) * 1.2, (c[2] - z) / rw]);

      // One leader all the way up — a mulga doesn't fork into a vase as the
      // palo verde does — with branches rising off it at a steep angle, the
      // low ones longest, out to the crown's skin.
      const lean = rng() * 6.28;
      const top: V3 = [x + Math.cos(lean) * rw * 0.06, h * 0.88, z + Math.sin(lean) * rw * 0.06];
      const F: V3 = lerp([x, 0, z], top, 0.22 / 0.88);
      const trunk: V3[][] = [[[x, 0, z], F]];
      const leader: V3[][] = [[F, top]];
      const branches: V3[][] = [];
      const twigs: V3[][] = [];
      const clusters: V3[][] = [];
      const NB = 13;
      for (let k = 0; k < NB; k++) {
        const t = 0.22 + (0.62 * (k + rng() * 0.6)) / NB;
        const A = lerp([x, 0, z], top, t / 0.88);
        const a = rot + k * 2.399963 + (rng() - 0.5) * 0.4;
        // Up at forty to sixty degrees, to the skin a little higher up; the
        // lowest ones flatter, spreading the crown wide just above the trunk.
        const low = 1 - smooth(0.22, 0.4, t);
        const ut = Math.min(0.96, t + (0.1 + 0.08 * rng()) * (1 - 0.6 * low));
        const r = rw * mulgaProf(ut) * (0.85 + 0.15 * rng());
        const B: V3 = [x + Math.cos(a) * r, ut * h, z + Math.sin(a) * r];
        branches.push([A, B]);
        const ends: V3[] = [B];
        for (let j = 0; j < 2; j++) {
          const S = lerp(A, B, 0.45 + 0.3 * rng());
          const aj = a + (j ? 0.6 : -0.6) * (0.6 + 0.6 * rng());
          const uj = Math.min(0.98, S[1] / h + 0.08 + 0.08 * rng());
          const rj = rw * mulgaProf(uj) * (0.8 + 0.2 * rng());
          const E: V3 = [x + Math.cos(aj) * rj, uj * h, z + Math.sin(aj) * rj];
          twigs.push([S, E]);
          ends.push(E);
        }
        clusters.push([A, ...ends]);
      }

      // Faint silver puffs along the outer half of every branch and twig:
      // a mulga's crown is as see-through as the palo verde's, its limbs
      // showing through it.
      const lobes: MulgaTree["lobes"] = [];
      const alpha = 0.17;
      for (const [A, ...ends] of clusters) {
        for (const E of ends) {
          for (const t of [0.8]) {
            const c = lerp(A, E, t);
            const rx = rw * (0.22 + 0.08 * rng());
            for (let k = 0; k < 3; k++) {
              const pc: V3 = [c[0] + (rng() - 0.5) * rx * 0.9, c[1] + (rng() - 0.5) * rx * 1.2, c[2] + (rng() - 0.5) * rx * 0.9];
              // None hangs below the crown's floor, or the bare trunk wears a
              // bubble.
              pc[1] = Math.max(pc[1], h * 0.26 + rx * 0.6);
              const sh = (0.45 + 0.55 * lightOf(outward(pc))) * 0.85 + 0.15;
              const tone = (pal: typeof MULGA_COLOURS) =>
                `rgba(${pal.shade.map((v, i) => (v + (pal.lit[i] - v) * sh) | 0).join(",")},${alpha})`;
              // Taller than wide: the phyllodes stand up off upright shoots.
              const prx = rx * (0.55 + 0.15 * rng());
              lobes.push({ c: pc, rx: prx, ry: prx * 1.15, col: [tone(MULGA_COLOURS), tone(MULGA_GOLD)] });
            }
          }
        }
      }

      // Phyllodes: thin silver needles, slanting up — the fine, misty
      // texture the catalog sells it on.
      const raw: { li: number; o: V3; slant: number; group: number }[] = [];
      for (let i = 0; i < 1100; i++) {
        const li = Math.floor(rng() * lobes.length);
        const L = lobes[li];
        const v = nrm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
        const r = Math.pow(rng(), 0.45);
        const o: V3 = [v[0] * L.rx * r, v[1] * L.ry * r, v[2] * L.rx * r];
        const c: V3 = [L.c[0] + o[0], L.c[1] + o[1], L.c[2] + o[2]];
        const n = outward(c);
        const e = Math.hypot((c[0] - x) / (rw * Math.max(0.3, mulgaProf(c[1] / h))), 0, (c[2] - z) / (rw * Math.max(0.3, mulgaProf(c[1] / h))));
        const sh = (0.3 + 0.7 * lightOf(nrm([n[0] + v[0], n[1] + v[1], n[2] + v[2]]))) * (0.6 + 0.4 * smooth(0.3, 1, e)) * (0.9 + 0.2 * rng());
        const level = Math.max(0, Math.min(MU_LEVELS - 1, Math.round(sh * (MU_LEVELS - 1))));
        // Up and to either side, never flat: screen angle from -π/2 (up).
        raw.push({ li, o, slant: -Math.PI / 2 + (rng() - 0.5) * 1.6, group: level });
      }
      raw.sort((a, b) => a.group - b.group);
      const NF = raw.length;
      const fleckLobe = new Uint16Array(NF);
      const fleckOff = new Float32Array(NF * 3);
      const fleckSlant = new Float32Array(NF);
      const groupStart = new Int32Array(MU_LEVELS + 1).fill(NF);
      raw.forEach((f, i) => {
        fleckLobe[i] = f.li;
        fleckOff.set(f.o, i * 3);
        fleckSlant[i] = f.slant;
        if (groupStart[f.group] === NF) groupStart[f.group] = i;
      });
      for (let gi = MU_LEVELS - 1; gi >= 0; gi--) groupStart[gi] = Math.min(groupStart[gi], groupStart[gi + 1]);
      return { limbs: [trunk, leader, branches, twigs], lobes, fleckLobe, fleckOff, fleckSlant, groupStart };
    }

    /** Mulga, after the app's mature model.
     *
     *  Unlike the three trees before it: narrow and upright, a single
     *  reddish-brown leader running nearly to the top with branches rising
     *  steeply off it, the low ones longest — so the crown is widest a
     *  third of the way up and tapers from there to a point, a cone over an
     *  oval. The palest crown in the catalog, a see-through silver mist of
     *  fine upright phyllodes with the red-brown limbs showing through.
     *
     *  Drawn as the trunk, leader, branches and twigs, each order one
     *  stroke; faint silver puffs, taller than wide, along the outer half
     *  of every branch, far first; then the phyllodes as thin needles
     *  slanting up, a tone at a time. Grown once and cached; flecks placed
     *  by their puff's projection, as the palo verde's are.
     */
    function drawMulgaBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = mulgaGrown.get(key);
      if (!grown) {
        if (mulgaGrown.size > 400) mulgaGrown.clear(); // growth and edits mint new keys
        grown = growMulga(x, z, h, rw, rot, seed);
        mulgaGrown.set(key, grown);
      }
      const pal = sel ? MULGA_GOLD : MULGA_COLOURS;
      const g = sel ? 1 : 0;

      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      const widths = [0.75, 0.4, 0.16, 0.07];
      const floors = [2.2, 1.6, 0.9, 0.6];
      grown.limbs.forEach((segs, order) => {
        ctx!.strokeStyle = order === 0 ? pal.trunk : order < 3 ? pal.limb : pal.twig;
        ctx!.lineWidth = Math.max(ftPx(x, z, widths[order]), floors[order]);
        ctx!.beginPath();
        for (const [a, b] of segs) {
          const p0 = P(a[0], a[1], a[2]);
          const p1 = P(b[0], b[1], b[2]);
          ctx!.moveTo(p0[0], p0[1]);
          ctx!.lineTo(p1[0], p1[1]);
        }
        ctx!.stroke();
      });
      ctx!.lineCap = "butt";

      const proj = grown.lobes.map((L) => {
        const [cx, cy, cz] = L.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { L, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      for (const { L, q, J } of proj.slice().sort((a, b) => b.q[2] - a.q[2])) {
        // An ellipsoid through the local (affine) map is an ellipse.
        const ax = [J[0] * L.rx, J[2] * L.ry, J[4] * L.rx];
        const ay = [J[1] * L.rx, J[3] * L.ry, J[5] * L.rx];
        const c11 = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
        const c22 = ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2];
        const c12 = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        ctx!.beginPath();
        ctx!.ellipse(q[0], q[1], Math.sqrt(mid + d), Math.sqrt(Math.max(0, mid - d)), 0.5 * Math.atan2(2 * c12, c11 - c22), 0, Math.PI * 2);
        ctx!.fillStyle = L.col[g];
        ctx!.fill();
      }

      const { fleckLobe, fleckOff, fleckSlant, groupStart } = grown;
      const half = Math.max(ftPx(x, z, 0.32), 1.3);
      const tones = MU_TONES[g];
      for (let gi = 0; gi < MU_LEVELS; gi++) {
        const from = groupStart[gi];
        const to = groupStart[gi + 1];
        if (from >= to) continue;
        ctx!.fillStyle = tones[gi];
        ctx!.beginPath();
        for (let i = from; i < to; i++) {
          // Filled a hundred and fifty at a time, as the mesquite's are.
          if (i > from && (i - from) % 150 === 0) {
            ctx!.fill();
            ctx!.beginPath();
          }
          const { q, J } = proj[fleckLobe[i]];
          const ox = fleckOff[i * 3];
          const oy = fleckOff[i * 3 + 1];
          const oz = fleckOff[i * 3 + 2];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          const a = fleckSlant[i];
          const ux = Math.cos(a) * half;
          const uy = Math.sin(a) * half;
          // A needle: long and thin.
          ctx!.moveTo(px + ux, py + uy);
          ctx!.lineTo(px - uy * 0.22, py + ux * 0.22);
          ctx!.lineTo(px - ux, py - uy);
          ctx!.lineTo(px + uy * 0.22, py - ux * 0.22);
          ctx!.closePath();
        }
        ctx!.fill();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per tree and kept, as the other trees are.
    type ChasteTree = {
      /** limbs by order — trunks, branches, twigs — as segments */
      limbs: [number, number, number][][][];
      /** masses of foliage over the crown's skin: centre, radii (across,
       *  up), the way its leaves face, tone */
      lobes: { c: [number, number, number]; rx: number; ry: number; n: [number, number, number]; col: [string, string] }[];
      /** palmate leaves, grouped by tone, each as its lobe, its offset from
       *  that lobe's centre, and the way it hangs */
      leafLobe: Uint16Array;
      leafOff: Float32Array;
      leafSlant: Float32Array;
      leafStart: Int32Array;
      /** flower spikes, grouped by tone, each as its lobe, its foot's
       *  offset from that lobe's centre, and its length and lean */
      spikeLobe: Uint16Array;
      spikeOff: Float32Array;
      spikeDir: Float32Array;
      spikeStart: Int32Array;
    };
    const CT_LEVELS = 6;
    const CT_SPIKE_LEVELS = 4;
    const ctRamp = (from: number[], to: number[], n: number) =>
      Array.from({ length: n }, (_, i) => {
        const t = i / (n - 1);
        return `rgb(${from.map((v, k) => (v + (to[k] - v) * t) | 0).join(",")})`;
      });
    const CT_LEAF_TONES = [CHASTE_COLOURS, CHASTE_GOLD].map((p) => ctRamp(p.leafShade, p.leafLit, CT_LEVELS));
    const CT_SPIKE_TONES = [CHASTE_COLOURS, CHASTE_GOLD].map((p) => ctRamp(p.spikeShade, p.spikeLit, CT_SPIKE_LEVELS));
    // A palmate leaf's five fingers: their turn off the leaf's line, and
    // their length — the middle one longest.
    const CT_FINGERS = [
      [-0.95, 0.6],
      [-0.48, 0.85],
      [0, 1],
      [0.48, 0.85],
      [0.95, 0.6],
    ];
    const chasteGrown = new Map<string, ChasteTree>();
    // The crown's radius (a fraction of rw) by height: a broad dome on a
    // drooping rim — its edge hanging to a third of the way up, widest just
    // under three fifths, the leaves topping out short of the spikes — as
    // the model's is.
    const chasteProf = (u: number) => {
      if (u < 0.34 || u > 0.93) return 0;
      if (u < 0.59) return 0.74 + 0.26 * Math.sin(((u - 0.34) / 0.25) * (Math.PI / 2));
      return Math.sqrt(Math.max(0, 1 - ((u - 0.59) / 0.34) ** 2));
    };

    function growChaste(x: number, z: number, h: number, rw: number, rot: number, seed: string): ChasteTree {
      const rng = rngFor("chaste:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const lightOf = (n: V3) => Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
      // Not quite round: a little longer one way, and lopsided, as the
      // model's crown is — each tree its own.
      const a1 = rng() * Math.PI * 2;
      const a2 = rng() * Math.PI * 2;
      // And the rim droops further on two sides than the other two, so from
      // some sides the trunks show under it.
      const a3 = rng() * Math.PI * 2;
      const rimU = (th: number) => 0.35 + 0.12 * (0.5 + 0.5 * Math.cos(2 * (th - a3)));
      const edge = (th: number) =>
        (1 - 0.08 * Math.sin(th - rot) ** 2) * (1 + 0.07 * Math.cos(th - a1) + 0.05 * Math.cos(2 * (th - a2)));
      const skinNormal = (th: number, u: number): V3 => {
        const lo = Math.max(0.34, u - 0.02);
        const hi = Math.min(0.93, u + 0.02);
        const d = (chasteProf(hi) - chasteProf(lo)) / (hi - lo);
        return nrm([Math.cos(th) * h, -d * rw, Math.sin(th) * h]);
      };
      // The way the leaves face: out from low in the crown. Under the
      // bulge the skin itself faces the ground, but the leaves hang on its
      // outside, seen from above as much as from the side.
      const leafward = (c: V3): V3 => nrm([(c[0] - x) / rw ** 2, (c[1] - h * 0.45) / (h * 0.5) ** 2, (c[2] - z) / rw ** 2]);

      // Four or five slim trunks from one foot, splaying into a vase and
      // kinking as they rise, each forking three ways where it meets the
      // crown.
      const trunks: V3[][] = [];
      const branches: V3[][] = [];
      const forks: V3[] = [];
      const NT = rng() < 0.5 ? 4 : 5;
      for (let k = 0; k < NT; k++) {
        const a = rot + (k / NT) * Math.PI * 2 + (rng() - 0.5) * 0.7;
        const foot: V3 = [x + Math.cos(a) * rw * 0.025, 0, z + Math.sin(a) * rw * 0.025];
        const am = a + (rng() - 0.5) * 0.6;
        const rm = rw * (0.07 + 0.07 * rng());
        const mid: V3 = [x + Math.cos(am) * rm, h * (0.18 + 0.08 * rng()), z + Math.sin(am) * rm];
        const rt = rw * (0.22 + 0.14 * rng());
        const top: V3 = [x + Math.cos(a) * rt, h * (0.42 + 0.08 * rng()), z + Math.sin(a) * rt];
        trunks.push([foot, mid], [mid, top]);
        for (let j = 0; j < 3; j++) {
          const ab = a + (j - 1) * 0.55 + (rng() - 0.5) * 0.3;
          const ub = 0.58 + 0.14 * rng();
          const rb = rw * chasteProf(ub) * (0.55 + 0.2 * rng());
          const B: V3 = [x + Math.cos(ab) * rb, ub * h, z + Math.sin(ab) * rb];
          branches.push([top, B]);
          forks.push(B);
        }
      }

      // Masses of foliage over the skin by area — a quarter on the
      // drooping sides, the rest over the broad top — drawn translucent:
      // where they pile up the crown is full, low down it thins enough for
      // the trunks to show through, as the model's does.
      const lobes: ChasteTree["lobes"] = [];
      const twigs: V3[][] = [];
      const alpha = 0.6;
      // Spread evenly — a spiral down the crown, a quarter on the sides —
      // so no stretch of it goes bare by chance.
      const NL = 140;
      for (let i = 0; i < NL; i++) {
        const f = (i + 0.2 + 0.6 * rng()) / NL;
        const th = rot + i * 2.399963 + (rng() - 0.5) * 0.5;
        const u0 = rimU(th);
        const u = f < 0.25 ? u0 + (0.59 - u0) * (f / 0.25) : 0.59 + 0.32 * Math.pow((f - 0.25) / 0.75, 0.9);
        const r = rw * chasteProf(u) * edge(th) * (0.78 + 0.1 * rng());
        const c: V3 = [x + Math.cos(th) * r, u * h, z + Math.sin(th) * r];
        const n = leafward(c);
        // Smaller on the rim, so the leaves hanging off it make its edge.
        const rx = rw * (0.17 + 0.07 * rng()) * (u < 0.59 ? 0.85 : 1);
        // Shaded by the skin, so the underside of the bulge is in shadow.
        const sh = (0.35 + 0.65 * lightOf(skinNormal(th, u))) * (0.6 + 0.4 * smooth(0.36, 0.8, u)) * (0.92 + 0.16 * rng());
        const tone = (pal: typeof CHASTE_COLOURS) =>
          `rgba(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * sh) | 0).join(",")},${alpha})`;
        lobes.push({ c, rx, ry: rx * 0.75, n, col: [tone(CHASTE_COLOURS), tone(CHASTE_GOLD)] });
        // Fed by a twig from the nearest fork.
        let best = forks[0];
        let bd = Infinity;
        for (const F of forks) {
          const d = (F[0] - c[0]) ** 2 + (F[1] - c[1]) ** 2 + (F[2] - c[2]) ** 2;
          if (d < bd) {
            bd = d;
            best = F;
          }
        }
        twigs.push([best, lerp(best, c, 0.9)]);
      }

      // Palmate leaves on the lobes' outer faces, hanging; the ones on the
      // rim hang below it, for its ragged edge.
      const leaves: { li: number; o: V3; slant: number; group: number }[] = [];
      for (let i = 0; i < 1100; i++) {
        const li = i % NL;
        const L = lobes[li];
        const v = nrm([L.n[0] + (rng() - 0.5) * 1.6, L.n[1] + (rng() - 0.5) * 1.6, L.n[2] + (rng() - 0.5) * 1.6]);
        // Out to the mass's edge and past it, so its outline is leaves.
        const r = 0.55 + 0.75 * rng();
        const o: V3 = [v[0] * L.rx * r, v[1] * L.ry * r, v[2] * L.rx * r];
        if (L.c[1] < h * 0.48) o[1] -= L.ry * 0.5 * rng();
        const lit = lightOf(nrm([L.n[0] + v[0], L.n[1] + v[1], L.n[2] + v[2]]));
        const sh = (0.25 + 0.75 * lit) * (0.85 + 0.3 * rng());
        const level = Math.max(0, Math.min(CT_LEVELS - 1, Math.round(sh * (CT_LEVELS - 1))));
        // Screen angle from π/2 (down), tipped either way.
        leaves.push({ li, o, slant: Math.PI / 2 + (rng() - 0.5) * 1.4, group: level });
      }
      leaves.sort((a, b) => a.group - b.group);
      const NF = leaves.length;
      const leafLobe = new Uint16Array(NF);
      const leafOff = new Float32Array(NF * 3);
      const leafSlant = new Float32Array(NF);
      const leafStart = new Int32Array(CT_LEVELS + 1).fill(NF);
      leaves.forEach((f, i) => {
        leafLobe[i] = f.li;
        leafOff.set(f.o, i * 3);
        leafSlant[i] = f.slant;
        if (leafStart[f.group] === NF) leafStart[f.group] = i;
      });
      for (let gi = CT_LEVELS - 1; gi >= 0; gi--) leafStart[gi] = Math.min(leafStart[gi], leafStart[gi + 1]);

      // Flower spikes standing up out of all but the lowest of the crown,
      // leaning out a little: the lavender the tree is planted for.
      const upper: number[] = [];
      lobes.forEach((L, i) => {
        if (L.c[1] > h * 0.45) upper.push(i);
      });
      const spikes: { li: number; o: V3; d: V3; group: number }[] = [];
      for (let i = 0; i < 380 && upper.length; i++) {
        const li = upper[i % upper.length];
        const L = lobes[li];
        const o: V3 = [
          L.n[0] * L.rx * 0.55 + (rng() - 0.5) * L.rx * 1.1,
          L.n[1] * L.ry * 0.55 + (rng() - 0.5) * L.ry * 0.6,
          L.n[2] * L.rx * 0.55 + (rng() - 0.5) * L.rx * 1.1,
        ];
        const len = 0.9 + 0.6 * rng();
        const lean = 0.1 + 0.4 * rng();
        const az = Math.atan2(L.c[2] - z, L.c[0] - x) + (rng() - 0.5) * 1.4;
        const d: V3 = [Math.sin(lean) * Math.cos(az) * len, Math.cos(lean) * len, Math.sin(lean) * Math.sin(az) * len];
        const sh = (0.35 + 0.65 * lightOf(L.n)) * (0.85 + 0.3 * rng());
        const level = Math.max(0, Math.min(CT_SPIKE_LEVELS - 1, Math.round(sh * (CT_SPIKE_LEVELS - 1))));
        spikes.push({ li, o, d, group: level });
      }
      spikes.sort((a, b) => a.group - b.group);
      const NS = spikes.length;
      const spikeLobe = new Uint16Array(NS);
      const spikeOff = new Float32Array(NS * 3);
      const spikeDir = new Float32Array(NS * 3);
      const spikeStart = new Int32Array(CT_SPIKE_LEVELS + 1).fill(NS);
      spikes.forEach((f, i) => {
        spikeLobe[i] = f.li;
        spikeOff.set(f.o, i * 3);
        spikeDir.set(f.d, i * 3);
        if (spikeStart[f.group] === NS) spikeStart[f.group] = i;
      });
      for (let gi = CT_SPIKE_LEVELS - 1; gi >= 0; gi--) spikeStart[gi] = Math.min(spikeStart[gi], spikeStart[gi + 1]);

      return {
        limbs: [trunks, branches, twigs],
        lobes,
        leafLobe,
        leafOff,
        leafSlant,
        leafStart,
        spikeLobe,
        spikeOff,
        spikeDir,
        spikeStart,
      };
    }

    /** Chaste tree, after the app's model.
     *
     *  The one tree in flower: a broad, soft dome, wider than it is tall,
     *  its edge drooping to a third of the way up, held on four or five
     *  slim grey-brown trunks that splay from one foot into a vase — and
     *  over the top of it, standing up out of the leaves, hundreds of
     *  lavender flower spikes. Grey-green palmate leaves, five fingers to
     *  a hand, hang off every part of the crown.
     *
     *  Drawn as the trunks, branches and twigs, each order one stroke;
     *  translucent masses of foliage over the crown's skin, far first, so
     *  the crown fills where they pile up and the trunks show through
     *  where they don't; the leaves a tone at a time; then the spikes.
     *  Grown once and cached; leaves and spikes placed by their mass's
     *  projection, as the palo verde's flecks are.
     */
    function drawChasteBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = chasteGrown.get(key);
      if (!grown) {
        if (chasteGrown.size > 400) chasteGrown.clear(); // growth and edits mint new keys
        grown = growChaste(x, z, h, rw, rot, seed);
        chasteGrown.set(key, grown);
      }
      const pal = sel ? CHASTE_GOLD : CHASTE_COLOURS;
      const g = sel ? 1 : 0;

      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      const widths = [0.42, 0.22, 0.08];
      const floors = [2, 1.2, 0.6];
      grown.limbs.forEach((segs, order) => {
        ctx!.strokeStyle = order === 0 ? pal.trunk : pal.limb;
        ctx!.lineWidth = Math.max(ftPx(x, z, widths[order]), floors[order]);
        ctx!.beginPath();
        for (const [a, b] of segs) {
          const p0 = P(a[0], a[1], a[2]);
          const p1 = P(b[0], b[1], b[2]);
          ctx!.moveTo(p0[0], p0[1]);
          ctx!.lineTo(p1[0], p1[1]);
        }
        ctx!.stroke();
      });
      ctx!.lineCap = "butt";

      const proj = grown.lobes.map((L) => {
        const [cx, cy, cz] = L.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { L, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      for (const { L, q, J } of proj.slice().sort((a, b) => b.q[2] - a.q[2])) {
        // An ellipsoid through the local (affine) map is an ellipse.
        const ax = [J[0] * L.rx, J[2] * L.ry, J[4] * L.rx];
        const ay = [J[1] * L.rx, J[3] * L.ry, J[5] * L.rx];
        const c11 = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
        const c22 = ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2];
        const c12 = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        ctx!.beginPath();
        ctx!.ellipse(q[0], q[1], Math.sqrt(mid + d), Math.sqrt(Math.max(0, mid - d)), 0.5 * Math.atan2(2 * c12, c11 - c22), 0, Math.PI * 2);
        ctx!.fillStyle = L.col[g];
        ctx!.fill();
      }

      // Leaves and spikes on the side facing the eye only: on the far side
      // they'd be under the near foliage anyway. Judged by the skin's
      // normal at their mass — a crown this flat isn't a ball, and judged
      // from its middle the whole far half of its top would go bare.
      const lobes = grown.lobes;
      const near = (L: (typeof lobes)[number], ox: number, oy: number, oz: number, slack: number) => {
        const ex = eye[0] - L.c[0] - ox;
        const ey = eye[1] - L.c[1] - oy;
        const ez = eye[2] - L.c[2] - oz;
        return L.n[0] * ex + L.n[1] * ey + L.n[2] * ez >= -slack * Math.hypot(ex, ey, ez);
      };

      const { leafLobe, leafOff, leafSlant, leafStart } = grown;
      const len = Math.max(ftPx(x, z, 0.8), 1.6);
      // Too small to see five fingers, a hand is one leaf-shaped fleck.
      const hands = len > 4.5;
      const leafTones = CT_LEAF_TONES[g];
      for (let gi = 0; gi < CT_LEVELS; gi++) {
        const from = leafStart[gi];
        const to = leafStart[gi + 1];
        if (from >= to) continue;
        ctx!.fillStyle = leafTones[gi];
        ctx!.beginPath();
        let n = 0;
        for (let i = from; i < to; i++) {
          const L = lobes[leafLobe[i]];
          const ox = leafOff[i * 3];
          const oy = leafOff[i * 3 + 1];
          const oz = leafOff[i * 3 + 2];
          if (!near(L, ox, oy, oz, 0)) continue;
          // Filled a hundred and fifty fingers at a time, as the mesquite's
          // flecks are.
          if (++n % (hands ? 30 : 150) === 0) {
            ctx!.fill();
            ctx!.beginPath();
          }
          const { q, J } = proj[leafLobe[i]];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          if (!hands) {
            const a = leafSlant[i];
            const ux = Math.cos(a) * len * 0.6;
            const uy = Math.sin(a) * len * 0.6;
            ctx!.moveTo(px + ux, py + uy);
            ctx!.lineTo(px - uy * 0.5, py + ux * 0.5);
            ctx!.lineTo(px - ux, py - uy);
            ctx!.lineTo(px + uy * 0.5, py - ux * 0.5);
            ctx!.closePath();
            continue;
          }
          // A hand of five narrow fingers from one point.
          for (const [turn, f] of CT_FINGERS) {
            const a = leafSlant[i] + turn;
            const dx = Math.cos(a) * len * f;
            const dy = Math.sin(a) * len * f;
            ctx!.moveTo(px, py);
            ctx!.lineTo(px + dx * 0.45 - dy * 0.12, py + dy * 0.45 + dx * 0.12);
            ctx!.lineTo(px + dx, py + dy);
            ctx!.lineTo(px + dx * 0.45 + dy * 0.12, py + dy * 0.45 - dx * 0.12);
            ctx!.closePath();
          }
        }
        ctx!.fill();
      }

      const { spikeLobe, spikeOff, spikeDir, spikeStart } = grown;
      const spikeTones = CT_SPIKE_TONES[g];
      for (let gi = 0; gi < CT_SPIKE_LEVELS; gi++) {
        const from = spikeStart[gi];
        const to = spikeStart[gi + 1];
        if (from >= to) continue;
        ctx!.fillStyle = spikeTones[gi];
        ctx!.beginPath();
        for (let i = from; i < to; i++) {
          if (i > from && (i - from) % 150 === 0) {
            ctx!.fill();
            ctx!.beginPath();
          }
          const L = lobes[spikeLobe[i]];
          const ox = spikeOff[i * 3];
          const oy = spikeOff[i * 3 + 1];
          const oz = spikeOff[i * 3 + 2];
          // A spike stands clear of the leaves, so it shows a little past
          // the crown's edge.
          if (!near(L, ox, oy, oz, 0.25)) continue;
          const { q, J } = proj[spikeLobe[i]];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          const vx = spikeDir[i * 3];
          const vy = spikeDir[i * 3 + 1];
          const vz = spikeDir[i * 3 + 2];
          const dx = J[0] * vx + J[2] * vy + J[4] * vz;
          const dy = J[1] * vx + J[3] * vy + J[5] * vz;
          const l = Math.hypot(dx, dy) || 1;
          // Thickest a quarter of the way up, tapering to its tip.
          const w = Math.max(l * 0.09, 0.6) / l;
          ctx!.moveTo(px - dx * 0.1, py - dy * 0.1);
          ctx!.lineTo(px + dx * 0.25 - dy * w, py + dy * 0.25 + dx * w);
          ctx!.lineTo(px + dx, py + dy);
          ctx!.lineTo(px + dx * 0.25 + dy * w, py + dy * 0.25 - dx * w);
          ctx!.closePath();
        }
        ctx!.fill();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per clump and kept, as the trees are.
    type FencePostClump = {
      stems: {
        /** where it stands, and the heights of its foot, its shoulder, two
         *  rings up its dome, and its apex */
        sx: number;
        sz: number;
        ys: number[];
        /** each ring's twelve points — crest, valley, crest… — as offsets
         *  (x, z) from the stem's axis, ring by ring */
        ring: Float32Array;
        /** each face's outward normal and tone, band by band (the shaft, two
         *  bands of dome, the cap), twelve to a band */
        faceN: Float32Array;
        faceTone: Uint8Array;
        /** whether each crest's felt is in the light */
        crestLit: Uint8Array;
      }[];
    };
    const FP_LEVELS = 8;
    const FP_RIBS = 6;
    const FP_TONES = [FENCE_POST_COLOURS, FENCE_POST_GOLD].map((pal) =>
      Array.from({ length: FP_LEVELS }, (_, i) => {
        const t = i / (FP_LEVELS - 1);
        return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
      }),
    );
    // The model's four stems in its own measure (its height = 1): where each
    // stands, how tall it is, how thick.
    const FP_STEMS = [
      [0.002, -0.039, 0.98, 0.067],
      [0.094, 0.027, 0.7, 0.066],
      [-0.105, -0.035, 0.566, 0.06],
      [-0.03, 0.051, 0.384, 0.05],
    ];
    const fencePostGrown = new Map<string, FencePostClump>();
    // Scratch for one stem's projected points, reused stem to stem.
    const fpScreen = new Float32Array(4 * 12 * 2);
    const fpSeen = new Float32Array(4 * 12);

    function growFencePost(x: number, z: number, h: number, rot: number): FencePostClump {
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      // Wrapped light, so the shaded side of a column still turns.
      const shadeOf = (n: V3) => Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5);
      const toneOf = (n: V3) => Math.max(0, Math.min(FP_LEVELS - 1, Math.round(shadeOf(n) * (FP_LEVELS - 1))));
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const stems = FP_STEMS.map(([mx, mz, mh, mr], si) => {
        const r = mr * h;
        const top = mh * h;
        // A blunt dome, a little lower than the stem is wide.
        const rd = r * 0.9;
        const y0 = top - rd;
        const ys = [0, y0, y0 + rd * Math.sin(0.55), y0 + rd * Math.sin(1.1), top];
        const across = [1, 1, Math.cos(0.55), Math.cos(1.1)];
        // Each stem's ribs turned its own way.
        const phase = rot + si * 0.9;
        const ring = new Float32Array(4 * 12 * 2);
        for (let l = 0; l < 4; l++) {
          for (let j = 0; j < 12; j++) {
            const a = phase + (j * Math.PI) / FP_RIBS;
            const rr = r * across[l] * (j % 2 ? 0.84 : 1);
            ring[(l * 12 + j) * 2] = Math.cos(a) * rr;
            ring[(l * 12 + j) * 2 + 1] = Math.sin(a) * rr;
          }
        }
        const pt = (l: number, j: number): V3 =>
          l === 4 ? [0, ys[4], 0] : [ring[(l * 12 + (j % 12)) * 2], ys[l], ring[(l * 12 + (j % 12)) * 2 + 1]];
        const faceN = new Float32Array(4 * 12 * 3);
        const faceTone = new Uint8Array(4 * 12);
        for (let b = 0; b < 4; b++) {
          for (let j = 0; j < 12; j++) {
            const A = pt(b, j);
            const B = pt(b, j + 1);
            const C = pt(b + 1, j + (b === 3 ? 0 : 1));
            const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
            const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
            let n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const l = Math.hypot(n[0], n[1], n[2]) || 1;
            n = [n[0] / l, n[1] / l, n[2] / l];
            // Outward: away from the axis, and up on the dome.
            const ox = (A[0] + B[0]) / 2;
            const oz = (A[2] + B[2]) / 2;
            if (n[0] * ox + n[2] * oz + (b ? n[1] * r : 0) < 0) n = [-n[0], -n[1], -n[2]];
            faceN.set(n, (b * 12 + j) * 3);
            faceTone[b * 12 + j] = toneOf(n);
          }
        }
        const crestLit = new Uint8Array(FP_RIBS);
        for (let k = 0; k < FP_RIBS; k++) {
          const a = phase + (2 * k * Math.PI) / FP_RIBS;
          crestLit[k] = shadeOf([Math.cos(a), 0, Math.sin(a)]) > 0.45 ? 1 : 0;
        }
        return {
          sx: x + (mx * cr - mz * sr) * h,
          sz: z + (mx * sr + mz * cr) * h,
          ys,
          ring,
          faceN,
          faceTone,
          crestLit,
        };
      });
      return { stems };
    }

    /** Mexican fence post, after the app's model.
     *
     *  Four stems from one foot, the tallest nearly the whole height and
     *  the others at seven, six and four tenths of it, each a column of six
     *  blunt ribs under a rounded dome — and down every rib crest a white
     *  stripe, the felt of its areoles, which is what anyone recognises the
     *  plant by. Mid green, lit on the side toward the light and turning
     *  through the shade around the far side.
     *
     *  Drawn stem by stem, far first: every face turned toward the eye
     *  filled in its own tone, the most oblique first so the faces either
     *  side of a groove overlap the right way round; then the felt down
     *  every crest that shows, the lit crests and the shaded ones a stroke
     *  each. Grown once and cached; each ring placed by its stem's
     *  projection.
     */
    function drawFencePostBody(
      x: number,
      z: number,
      h: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rot}`;
      let grown = fencePostGrown.get(key);
      if (!grown) {
        if (fencePostGrown.size > 400) fencePostGrown.clear(); // growth and edits mint new keys
        grown = growFencePost(x, z, h, rot);
        fencePostGrown.set(key, grown);
      }
      const pal = sel ? FENCE_POST_GOLD : FENCE_POST_COLOURS;
      const tones = FP_TONES[sel ? 1 : 0];

      const order = grown.stems
        .map((st) => ({ st, d: P(st.sx, st.ys[1] * 0.5, st.sz)[2] }))
        .sort((a, b) => b.d - a.d);
      ctx!.lineJoin = "round";
      ctx!.lineCap = "round";
      for (const { st } of order) {
        const lc = st.ys.map((y) => P(st.sx, y, st.sz));
        const ym = st.ys[1] * 0.5;
        const q = lc[0];
        const qx = P(st.sx + 1, 0, st.sz);
        const qz = P(st.sx, 0, st.sz + 1);
        const jx0 = qx[0] - q[0];
        const jx1 = qx[1] - q[1];
        const jz0 = qz[0] - q[0];
        const jz1 = qz[1] - q[1];
        for (let l = 0; l < 4; l++) {
          for (let j = 0; j < 12; j++) {
            const i = l * 12 + j;
            const ox = st.ring[i * 2];
            const oz = st.ring[i * 2 + 1];
            fpScreen[i * 2] = lc[l][0] + jx0 * ox + jz0 * oz;
            fpScreen[i * 2 + 1] = lc[l][1] + jx1 * ox + jz1 * oz;
          }
        }
        let vx = eye[0] - st.sx;
        let vy = eye[1] - ym;
        let vz = eye[2] - st.sz;
        const vl = Math.hypot(vx, vy, vz) || 1;
        vx /= vl;
        vy /= vl;
        vz /= vl;
        const faces: number[] = [];
        for (let f = 0; f < 48; f++) {
          const d = st.faceN[f * 3] * vx + st.faceN[f * 3 + 1] * vy + st.faceN[f * 3 + 2] * vz;
          fpSeen[f] = d;
          if (d > 0) faces.push(f);
        }
        faces.sort((a, b) => fpSeen[a] - fpSeen[b]);
        let cur = -1;
        for (const f of faces) {
          const b = (f / 12) | 0;
          const j = f % 12;
          const j1 = (j + 1) % 12;
          const t = st.faceTone[f];
          if (t !== cur) {
            ctx!.fillStyle = tones[t];
            cur = t;
          }
          ctx!.beginPath();
          ctx!.moveTo(fpScreen[(b * 12 + j) * 2], fpScreen[(b * 12 + j) * 2 + 1]);
          ctx!.lineTo(fpScreen[(b * 12 + j1) * 2], fpScreen[(b * 12 + j1) * 2 + 1]);
          if (b === 3) {
            ctx!.lineTo(lc[4][0], lc[4][1]);
          } else {
            ctx!.lineTo(fpScreen[((b + 1) * 12 + j1) * 2], fpScreen[((b + 1) * 12 + j1) * 2 + 1]);
            ctx!.lineTo(fpScreen[((b + 1) * 12 + j) * 2], fpScreen[((b + 1) * 12 + j) * 2 + 1]);
          }
          ctx!.closePath();
          // A hairline of its own colour closes the seams between faces.
          ctx!.fill();
        }

        // The felt: down each crest wherever a face beside it shows.
        ctx!.lineWidth = Math.max(ftPx(st.sx, st.sz, 0.12), 0.7);
        for (const lit of [0, 1]) {
          ctx!.beginPath();
          for (let k = 0; k < FP_RIBS; k++) {
            if (st.crestLit[k] !== lit) continue;
            const j = 2 * k;
            const jl = (j + 11) % 12;
            let pen = false;
            for (let b = 0; b < 4; b++) {
              const shows = fpSeen[b * 12 + j] > 0 || fpSeen[b * 12 + jl] > 0;
              if (!shows) {
                pen = false;
                continue;
              }
              if (!pen) ctx!.moveTo(fpScreen[(b * 12 + j) * 2], fpScreen[(b * 12 + j) * 2 + 1]);
              if (b === 3) ctx!.lineTo(lc[4][0], lc[4][1]);
              else ctx!.lineTo(fpScreen[((b + 1) * 12 + j) * 2], fpScreen[((b + 1) * 12 + j) * 2 + 1]);
              pen = true;
            }
          }
          ctx!.strokeStyle = lit ? pal.felt : pal.feltShade;
          ctx!.stroke();
        }
      }
      ctx!.lineCap = "butt";
      ctx!.lineWidth = lw;
    }

    // Grown once per clump and kept, as the trees are.
    type OrganPipeClump = {
      stems: {
        /** its radius */
        r: number;
        /** the centre of each ring — foot, halfway, shoulder, two up the
         *  tip — and the apex, as (x, y, z) */
        axis: Float32Array;
        /** each ring's points — crest, groove, crest… — as offsets (x, z)
         *  from its centre */
        ring: Float32Array;
        /** each face's outward normal and tone, band by band */
        faceN: Float32Array;
        faceTone: Uint8Array;
      }[];
    };
    const OP_LEVELS = 8;
    const OP_RIBS = 14;
    const OP_PTS = OP_RIBS * 2;
    const OP_BANDS = 5;
    // Two ramps a palette: the stem, and its paler tip.
    const OP_TONES = [ORGAN_PIPE_COLOURS, ORGAN_PIPE_GOLD].map((pal) =>
      [pal.lit, pal.tip].flatMap((hi, ramp) =>
        Array.from({ length: OP_LEVELS }, (_, i) => {
          const t = i / (OP_LEVELS - 1);
          const lo = ramp ? pal.shade.map((v, k) => v + (pal.tip[k] - v) * 0.35) : pal.shade;
          return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
        }),
      ),
    );
    // The model's six stems in its own measure (its height = 1): foot,
    // halfway and top as (x, z), how tall each grows, and its radius —
    // three tall ones leaning a little apart, three short ones round them.
    const OP_STEMS = [
      [-0.069, 0.144, -0.103, 0.144, -0.12, 0.127, 1.0, 0.043],
      [0.069, 0.137, 0.072, 0.144, 0.084, 0.151, 0.93, 0.045],
      [-0.01, -0.058, -0.024, -0.045, -0.041, -0.041, 0.74, 0.043],
      [0.076, 0.086, 0.069, 0.069, 0.062, 0.052, 0.46, 0.041],
      [0.107, -0.141, 0.118, -0.153, 0.122, -0.152, 0.28, 0.038],
      [-0.108, -0.056, -0.1, -0.041, -0.1, -0.041, 0.18, 0.034],
    ];
    const organPipeGrown = new Map<string, OrganPipeClump>();
    // Scratch for one stem's projected points, reused stem to stem.
    const opScreen = new Float32Array(5 * OP_PTS * 2);
    const opSeen = new Float32Array(OP_BANDS * OP_PTS);
    const opBuckets: number[][] = Array.from({ length: OP_LEVELS * 2 }, () => []);

    function growOrganPipe(x: number, z: number, h: number, rot: number): OrganPipeClump {
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const shadeOf = (n: V3) => Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5);
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const turn = (mx: number, mz: number) => [x + (mx * cr - mz * sr) * h, z + (mx * sr + mz * cr) * h];
      const stems = OP_STEMS.map(([bx, bz, , , tx, tz, mh, mr], si) => {
        const r = mr * h;
        const top = mh * h;
        // A rounded tip, a little longer than the stem is wide.
        const rd = r * 1.1;
        const [fx, fz] = turn(bx, bz);
        const [ux, uz] = turn(tx, tz);
        // Straight from foot to top, leaning as the model's does — its
        // halfway point is within an inch of the line, and a kink there
        // reads as a joint.
        const at = (f: number): [number, number] => [fx + (ux - fx) * f, fz + (uz - fz) * f];
        const ys = [0, top * 0.5, top - rd, top - rd + rd * Math.sin(0.6), top - rd + rd * Math.sin(1.15), top];
        // One width up the shaft, narrowing a little into the tip.
        const across = [1, 1, 0.92, 0.92 * Math.cos(0.6), 0.92 * Math.cos(1.15)];
        const axis = new Float32Array(6 * 3);
        ys.forEach((y, l) => {
          const [cx, cz] = at(Math.min(1, y / top));
          axis.set([cx, y, cz], l * 3);
        });
        const phase = rot + si * 1.3;
        const ring = new Float32Array(5 * OP_PTS * 2);
        for (let l = 0; l < 5; l++) {
          for (let j = 0; j < OP_PTS; j++) {
            const a = phase + (j * Math.PI) / OP_RIBS;
            const rr = r * across[l] * (j % 2 ? 0.86 : 1);
            ring[(l * OP_PTS + j) * 2] = Math.cos(a) * rr;
            ring[(l * OP_PTS + j) * 2 + 1] = Math.sin(a) * rr;
          }
        }
        const pt = (l: number, j: number): V3 =>
          l === 5
            ? [axis[15], axis[16], axis[17]]
            : [
                axis[l * 3] + ring[(l * OP_PTS + (j % OP_PTS)) * 2],
                axis[l * 3 + 1],
                axis[l * 3 + 2] + ring[(l * OP_PTS + (j % OP_PTS)) * 2 + 1],
              ];
        const faceN = new Float32Array(OP_BANDS * OP_PTS * 3);
        const faceTone = new Uint8Array(OP_BANDS * OP_PTS);
        for (let b = 0; b < OP_BANDS; b++) {
          for (let j = 0; j < OP_PTS; j++) {
            const A = pt(b, j);
            const B = pt(b, j + 1);
            const C = pt(b + 1, j + (b === OP_BANDS - 1 ? 0 : 1));
            const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
            const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
            let n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const ln = Math.hypot(n[0], n[1], n[2]) || 1;
            n = [n[0] / ln, n[1] / ln, n[2] / ln];
            // Outward: away from the axis, and up on the tip.
            const ox = (A[0] + B[0]) / 2 - axis[b * 3];
            const oz = (A[2] + B[2]) / 2 - axis[b * 3 + 2];
            if (n[0] * ox + n[2] * oz + (b >= 2 ? n[1] * r : 0) < 0) n = [-n[0], -n[1], -n[2]];
            faceN.set(n, (b * OP_PTS + j) * 3);
            const level = Math.max(0, Math.min(OP_LEVELS - 1, Math.round(shadeOf(n) * (OP_LEVELS - 1))));
            // The tip pales with new growth.
            faceTone[b * OP_PTS + j] = (b >= 3 ? OP_LEVELS : 0) + level;
          }
        }
        return { r, axis, ring, faceN, faceTone };
      });
      return { stems };
    }

    /** Organ pipe cactus, after the app's model.
     *
     *  Nothing like the fence post's four bright striped columns: six
     *  stems from one base — three tall ones, the tallest the whole height,
     *  leaning a little apart as they rise, and three short ones round
     *  their feet — each a thick column of fourteen low ribs, so it reads
     *  as finely fluted rather than paneled. A dark grey-green, its ribs
     *  turning through light and shade, paler at the rounded tips where
     *  the new growth and grey spines are.
     *
     *  Drawn stem by stem, far first: its silhouette filled dark, so the
     *  seams between faces read as the grooves they are; then every face
     *  turned toward the eye, a tone at a time; then, close enough to see
     *  them, the grey spine clusters spaced down every rib that shows.
     *  Grown once and cached; each ring placed by its stem's projection.
     */
    function drawOrganPipeBody(
      x: number,
      z: number,
      h: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rot}`;
      let grown = organPipeGrown.get(key);
      if (!grown) {
        if (organPipeGrown.size > 400) organPipeGrown.clear(); // growth and edits mint new keys
        grown = growOrganPipe(x, z, h, rot);
        organPipeGrown.set(key, grown);
      }
      const tones = OP_TONES[sel ? 1 : 0];

      const order = grown.stems
        .map((st) => ({ st, d: P(st.axis[3], st.axis[4], st.axis[5])[2] }))
        .sort((a, b) => b.d - a.d);
      for (const { st } of order) {
        const lc: [number, number, number][] = [];
        for (let l = 0; l < 6; l++) lc.push(P(st.axis[l * 3], st.axis[l * 3 + 1], st.axis[l * 3 + 2]));
        const q = lc[0];
        const qx = P(st.axis[0] + 1, 0, st.axis[2]);
        const qz = P(st.axis[0], 0, st.axis[2] + 1);
        const jx0 = qx[0] - q[0];
        const jx1 = qx[1] - q[1];
        const jz0 = qz[0] - q[0];
        const jz1 = qz[1] - q[1];
        for (let l = 0; l < 5; l++) {
          for (let j = 0; j < OP_PTS; j++) {
            const i = l * OP_PTS + j;
            const ox = st.ring[i * 2];
            const oz = st.ring[i * 2 + 1];
            opScreen[i * 2] = lc[l][0] + jx0 * ox + jz0 * oz;
            opScreen[i * 2 + 1] = lc[l][1] + jx1 * ox + jz1 * oz;
          }
        }
        let vx = eye[0] - st.axis[3];
        let vy = eye[1] - st.axis[4];
        let vz = eye[2] - st.axis[5];
        const vl = Math.hypot(vx, vy, vz) || 1;
        vx /= vl;
        vy /= vl;
        vz /= vl;
        for (const bucket of opBuckets) bucket.length = 0;
        for (let f = 0; f < OP_BANDS * OP_PTS; f++) {
          const d = st.faceN[f * 3] * vx + st.faceN[f * 3 + 1] * vy + st.faceN[f * 3 + 2] * vz;
          opSeen[f] = d;
          if (d > 0) opBuckets[st.faceTone[f]].push(f);
        }

        // The silhouette, dark: the outline of the widest rings and the apex.
        const hull = convexHull(
          Array.from({ length: 3 * OP_PTS + 1 }, (_, k): [number, number] => {
            if (k === 3 * OP_PTS) return [lc[5][0], lc[5][1]];
            const i = k < OP_PTS ? k : k < 2 * OP_PTS ? OP_PTS + (k - OP_PTS) : 2 * OP_PTS + (k - 2 * OP_PTS);
            return [opScreen[i * 2], opScreen[i * 2 + 1]];
          }),
        );
        if (hull.length > 2) {
          ctx!.beginPath();
          ctx!.moveTo(hull[0][0], hull[0][1]);
          for (let i = 1; i < hull.length; i++) ctx!.lineTo(hull[i][0], hull[i][1]);
          ctx!.closePath();
          ctx!.fillStyle = tones[0];
          ctx!.fill();
        }

        opBuckets.forEach((faces, t) => {
          if (!faces.length) return;
          ctx!.beginPath();
          for (const f of faces) {
            const b = (f / OP_PTS) | 0;
            const j = f % OP_PTS;
            const j1 = (j + 1) % OP_PTS;
            ctx!.moveTo(opScreen[(b * OP_PTS + j) * 2], opScreen[(b * OP_PTS + j) * 2 + 1]);
            ctx!.lineTo(opScreen[(b * OP_PTS + j1) * 2], opScreen[(b * OP_PTS + j1) * 2 + 1]);
            if (b === OP_BANDS - 1) {
              ctx!.lineTo(lc[5][0], lc[5][1]);
            } else {
              ctx!.lineTo(opScreen[((b + 1) * OP_PTS + j1) * 2], opScreen[((b + 1) * OP_PTS + j1) * 2 + 1]);
              ctx!.lineTo(opScreen[((b + 1) * OP_PTS + j) * 2], opScreen[((b + 1) * OP_PTS + j) * 2 + 1]);
            }
            ctx!.closePath();
          }
          ctx!.fillStyle = tones[t];
          ctx!.fill();
        });

        // Spine clusters every few inches down each rib, close up only —
        // a speckled line, not a row of dots.
        const rPx = Math.hypot(jx0, jx1) * st.r;
        if (rPx > 7) {
          const dot = Math.max(ftPx(st.axis[0], st.axis[2], 0.07), 0.8);
          const n = Math.max(2, Math.round((st.axis[7] - st.axis[1]) / 0.3));
          ctx!.beginPath();
          for (let j = 0; j < OP_PTS; j += 2) {
            const jl = (j + OP_PTS - 1) % OP_PTS;
            if (opSeen[j] <= 0 && opSeen[jl] <= 0) continue;
            const ax = opScreen[j * 2];
            const ay = opScreen[j * 2 + 1];
            const bx = opScreen[(2 * OP_PTS + j) * 2];
            const by = opScreen[(2 * OP_PTS + j) * 2 + 1];
            for (let k = 0; k < n; k++) {
              // Each a little off its spacing, by a hash of rib and place.
              const t = (k + 0.5 + 0.35 * Math.sin(k * 12.9898 + j * 78.233)) / n;
              ctx!.rect(ax + (bx - ax) * t - dot / 2, ay + (by - ay) * t - dot / 2, dot, dot);
            }
          }
          ctx!.fillStyle = sel ? ORGAN_PIPE_GOLD.spines : ORGAN_PIPE_COLOURS.spines;
          ctx!.fill();
        }
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the trees are.
    type ToothpickPlant = {
      limbs: {
        /** its radius */
        r: number;
        /** ring centres along the limb, then its apex, as (x, y, z) */
        c: Float32Array;
        /** each ring's points — crest, groove, crest… — as offsets
         *  (x, y, z) from its centre */
        o: Float32Array;
        rings: number;
        /** rings along its length before the tip's */
        shaft: number;
        /** each face's outward normal and tone, band by band; the last
         *  band closes the tip on the apex */
        faceN: Float32Array;
        faceTone: Uint8Array;
        /** the runs of bands drawn as one piece: each straight enough
         *  that it never hides part of itself */
        pieces: [number, number][];
        /** the way the tip points, for its crown of spines */
        tip: [number, number, number];
      }[];
    };
    const TP_LEVELS = 8;
    const TP_RIBS = 8;
    const TP_PTS = TP_RIBS * 2;
    const TP_TONES = [TOOTHPICK_COLOURS, TOOTHPICK_GOLD].map((pal) =>
      Array.from({ length: TP_LEVELS }, (_, i) => {
        const t = i / (TP_LEVELS - 1);
        return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
      }),
    );
    // The model's trunk and two arms in its own measure (its height = 1),
    // all in one plane: the line each follows, its radius, and where an
    // arm's elbow ends and its upright begins.
    const TP_LIMBS: { path: [number, number][]; r: number; split: number }[] = [
      { path: [[0, 0], [0, 0.47], [0, 0.94]], r: 0.04, split: 0 },
      // Out of the trunk a quarter of the way up, dipping, then up.
      { path: [[-0.02, 0.27], [-0.075, 0.245], [-0.125, 0.258], [-0.145, 0.31], [-0.145, 0.585]], r: 0.034, split: 2 },
      // Higher, shorter in reach, taller.
      { path: [[0.02, 0.405], [0.06, 0.39], [0.092, 0.41], [0.1, 0.46], [0.1, 0.69]], r: 0.03, split: 2 },
    ];
    const toothpickGrown = new Map<string, ToothpickPlant>();
    // Scratch for one limb's projected points, reused limb to limb.
    const tpScreen = new Float32Array(8 * TP_PTS * 2);
    const tpSeen = new Float32Array(8 * TP_PTS);
    const tpBuckets: number[][] = Array.from({ length: TP_LEVELS }, () => []);

    function growToothpick(x: number, z: number, h: number, rot: number): ToothpickPlant {
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const shadeOf = (n: V3) => Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5);
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      // The model's plane turned with the plant: its x, its depth, and up.
      const place = (px: number, py: number, pz: number): V3 => [
        x + (px * cr - pz * sr) * h,
        py * h,
        z + (px * sr + pz * cr) * h,
      ];
      const dir = (px: number, py: number, pz: number): V3 => [px * cr - pz * sr, py, px * sr + pz * cr];
      const limbs = TP_LIMBS.map(({ path, r: mr, split }, li) => {
        const r = mr * h;
        const nP = path.length;
        // Tangents along the path, in the model's plane.
        const tan = path.map((_, i) => {
          const a = path[Math.max(0, i - 1)];
          const b = path[Math.min(nP - 1, i + 1)];
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        });
        // Each ring: centre, the way across it in the plane, its size.
        const rings: { c: [number, number]; t: number[]; f: number }[] = path.map((c, i) => ({ c, t: tan[i], f: 1 }));
        // A blunt tip as long as the limb is wide.
        const [lx, ly] = path[nP - 1];
        const [tx, ty] = tan[nP - 1];
        for (const sv of [0.6, 1.15]) {
          rings.push({ c: [lx + tx * mr * Math.sin(sv), ly + ty * mr * Math.sin(sv)], t: tan[nP - 1], f: 0.92 * Math.cos(sv) });
        }
        const nR = rings.length;
        const c = new Float32Array((nR + 1) * 3);
        const o = new Float32Array(nR * TP_PTS * 3);
        const phase = rot + li * 0.4;
        rings.forEach((ring, k) => {
          c.set(place(ring.c[0], ring.c[1], 0), k * 3);
          // Across the limb: in the plane (perpendicular to its line), and
          // through the plane.
          const e2 = dir(ring.t[1], -ring.t[0], 0);
          const e1 = dir(0, 0, 1);
          for (let j = 0; j < TP_PTS; j++) {
            const a = phase + (j * Math.PI) / TP_RIBS;
            const rr = r * ring.f * (j % 2 ? 0.88 : 1);
            o.set(
              [0, 1, 2].map((q) => rr * (Math.cos(a) * e2[q] + Math.sin(a) * e1[q])),
              (k * TP_PTS + j) * 3,
            );
          }
        });
        c.set(place(lx + tx * mr, ly + ty * mr, 0), nR * 3);
        const pt = (k: number, j: number): V3 =>
          k === nR
            ? [c[nR * 3], c[nR * 3 + 1], c[nR * 3 + 2]]
            : [0, 1, 2].map((q) => c[k * 3 + q] + o[(k * TP_PTS + (j % TP_PTS)) * 3 + q]) as V3;
        const faceN = new Float32Array(nR * TP_PTS * 3);
        const faceTone = new Uint8Array(nR * TP_PTS);
        for (let b = 0; b < nR; b++) {
          for (let j = 0; j < TP_PTS; j++) {
            const A = pt(b, j);
            const B = pt(b, j + 1);
            const C = pt(b + 1, j + (b === nR - 1 ? 0 : 1));
            const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
            const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
            let n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const ln = Math.hypot(n[0], n[1], n[2]) || 1;
            n = [n[0] / ln, n[1] / ln, n[2] / ln];
            // Outward: away from the limb's line (the last path ring, for
            // the tip).
            const k0 = Math.min(b, nP - 1);
            const mx = (A[0] + B[0]) / 2 - c[k0 * 3];
            const my = (A[1] + B[1]) / 2 - c[k0 * 3 + 1];
            const mz = (A[2] + B[2]) / 2 - c[k0 * 3 + 2];
            if (n[0] * mx + n[1] * my + n[2] * mz < 0) n = [-n[0], -n[1], -n[2]];
            faceN.set(n, (b * TP_PTS + j) * 3);
            faceTone[b * TP_PTS + j] = Math.max(0, Math.min(TP_LEVELS - 1, Math.round(shadeOf(n) * (TP_LEVELS - 1))));
          }
        }
        const pieces: [number, number][] = split ? [[0, split], [split, nR]] : [[0, nR]];
        return { r, c, o, rings: nR, shaft: nP, faceN, faceTone, pieces, tip: dir(tx, ty, 0) };
      });
      return { limbs };
    }

    /** Argentine toothpick, after the app's model.
     *
     *  One trunk nearly the whole height and two arms — the lower out of it
     *  a quarter of the way up, dipping before it turns up, the higher
     *  reaching less far and rising further — each a column of eight
     *  rounded ribs in a light olive green, every rib bristling with the
     *  long tan spines the plant is named for, and a reddish crown of
     *  them at every tip.
     *
     *  Drawn piece by piece, far first — the trunk, and each arm as its
     *  elbow and its upright, each straight enough never to hide part of
     *  itself: the faces turned toward the eye a tone at a time, then,
     *  close enough to see them, the spines out of every rib that shows,
     *  and the crowns. Grown once and cached; each ring placed by its
     *  limb's projection.
     */
    function drawToothpickBody(
      x: number,
      z: number,
      h: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rot}`;
      let grown = toothpickGrown.get(key);
      if (!grown) {
        if (toothpickGrown.size > 400) toothpickGrown.clear(); // growth and edits mint new keys
        grown = growToothpick(x, z, h, rot);
        toothpickGrown.set(key, grown);
      }
      const pal = sel ? TOOTHPICK_GOLD : TOOTHPICK_COLOURS;
      const tones = TP_TONES[sel ? 1 : 0];

      const pieces: { li: number; from: number; to: number; d: number }[] = [];
      grown.limbs.forEach((lb, li) => {
        for (const [from, to] of lb.pieces) {
          const k = Math.min(lb.rings - 1, (from + to) >> 1);
          pieces.push({ li, from, to, d: P(lb.c[k * 3], lb.c[k * 3 + 1], lb.c[k * 3 + 2])[2] });
        }
      });
      pieces.sort((a, b) => b.d - a.d);
      ctx!.lineCap = "round";
      let projected = -1;
      let lc: [number, number, number][] = [];
      let J = [0, 0, 0, 0, 0, 0];
      for (const { li, from, to } of pieces) {
        const lb = grown.limbs[li];
        if (projected !== li) {
          // The limb's rings, projected once for both its pieces.
          lc = [];
          for (let k = 0; k <= lb.rings; k++) lc.push(P(lb.c[k * 3], lb.c[k * 3 + 1], lb.c[k * 3 + 2]));
          const q = lc[0];
          const qx = P(lb.c[0] + 1, lb.c[1], lb.c[2]);
          const qy = P(lb.c[0], lb.c[1] + 1, lb.c[2]);
          const qz = P(lb.c[0], lb.c[1], lb.c[2] + 1);
          J = [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]];
          for (let k = 0; k < lb.rings; k++) {
            for (let j = 0; j < TP_PTS; j++) {
              const i = k * TP_PTS + j;
              const ox = lb.o[i * 3];
              const oy = lb.o[i * 3 + 1];
              const oz = lb.o[i * 3 + 2];
              tpScreen[i * 2] = lc[k][0] + J[0] * ox + J[2] * oy + J[4] * oz;
              tpScreen[i * 2 + 1] = lc[k][1] + J[1] * ox + J[3] * oy + J[5] * oz;
            }
          }
          const mid = Math.min(lb.rings - 1, lb.rings >> 1);
          let vx = eye[0] - lb.c[mid * 3];
          let vy = eye[1] - lb.c[mid * 3 + 1];
          let vz = eye[2] - lb.c[mid * 3 + 2];
          const vl = Math.hypot(vx, vy, vz) || 1;
          vx /= vl;
          vy /= vl;
          vz /= vl;
          for (let f = 0; f < lb.rings * TP_PTS; f++) {
            tpSeen[f] = lb.faceN[f * 3] * vx + lb.faceN[f * 3 + 1] * vy + lb.faceN[f * 3 + 2] * vz;
          }
          projected = li;
        }

        for (const bucket of tpBuckets) bucket.length = 0;
        for (let f = from * TP_PTS; f < to * TP_PTS; f++) if (tpSeen[f] > 0) tpBuckets[lb.faceTone[f]].push(f);
        tpBuckets.forEach((faces, t) => {
          if (!faces.length) return;
          ctx!.beginPath();
          for (const f of faces) {
            const b = (f / TP_PTS) | 0;
            const j = f % TP_PTS;
            const j1 = (j + 1) % TP_PTS;
            ctx!.moveTo(tpScreen[(b * TP_PTS + j) * 2], tpScreen[(b * TP_PTS + j) * 2 + 1]);
            ctx!.lineTo(tpScreen[(b * TP_PTS + j1) * 2], tpScreen[(b * TP_PTS + j1) * 2 + 1]);
            if (b === lb.rings - 1) {
              ctx!.lineTo(lc[lb.rings][0], lc[lb.rings][1]);
            } else {
              ctx!.lineTo(tpScreen[((b + 1) * TP_PTS + j1) * 2], tpScreen[((b + 1) * TP_PTS + j1) * 2 + 1]);
              ctx!.lineTo(tpScreen[((b + 1) * TP_PTS + j) * 2], tpScreen[((b + 1) * TP_PTS + j) * 2 + 1]);
            }
            ctx!.closePath();
          }
          ctx!.fillStyle = tones[t];
          ctx!.fill();
        });

        // The spines, close enough to see them: three out of each areole,
        // every few inches down every rib that shows — one straight out,
        // one tipped toward the limb's end, one across — a small star.
        const rPx = Math.hypot(J[0], J[1]) * lb.r;
        const spine = 0.22;
        const sx = (vx: number, vy: number, vz: number) => J[0] * vx + J[2] * vy + J[4] * vz;
        const sy = (vx: number, vy: number, vz: number) => J[1] * vx + J[3] * vy + J[5] * vz;
        if (rPx > 3.5) {
          ctx!.beginPath();
          for (let b = from; b < Math.min(to, lb.shaft - 1); b++) {
            const tx = lb.c[(b + 1) * 3] - lb.c[b * 3];
            const ty = lb.c[(b + 1) * 3 + 1] - lb.c[b * 3 + 1];
            const tz = lb.c[(b + 1) * 3 + 2] - lb.c[b * 3 + 2];
            const len = Math.hypot(tx, ty, tz) || 1;
            const n = Math.max(1, Math.round(len / 0.3));
            for (let j = 0; j < TP_PTS; j += 2) {
              if (tpSeen[b * TP_PTS + j] <= 0 && tpSeen[b * TP_PTS + ((j + TP_PTS - 1) % TP_PTS)] <= 0) continue;
              const i0 = b * TP_PTS + j;
              const i1 = (b + 1) * TP_PTS + j;
              const ol = Math.hypot(lb.o[i0 * 3], lb.o[i0 * 3 + 1], lb.o[i0 * 3 + 2]) || 1;
              const nx = lb.o[i0 * 3] / ol;
              const ny = lb.o[i0 * 3 + 1] / ol;
              const nz = lb.o[i0 * 3 + 2] / ol;
              const ax = sx(nx * spine, ny * spine, nz * spine);
              const ay = sy(nx * spine, ny * spine, nz * spine);
              const k1 = (spine * 0.8) / len;
              const bx = sx(nx * spine * 0.6 + tx * k1, ny * spine * 0.6 + ty * k1, nz * spine * 0.6 + tz * k1);
              const by = sy(nx * spine * 0.6 + tx * k1, ny * spine * 0.6 + ty * k1, nz * spine * 0.6 + tz * k1);
              // Across: round the limb, the next crest's way.
              const i2 = b * TP_PTS + ((j + 2) % TP_PTS);
              const wx = (lb.o[i2 * 3] - lb.o[i0 * 3]) / ol;
              const wy = (lb.o[i2 * 3 + 1] - lb.o[i0 * 3 + 1]) / ol;
              const wz = (lb.o[i2 * 3 + 2] - lb.o[i0 * 3 + 2]) / ol;
              const cx = sx((nx * 0.6 + wx * 0.7) * spine, (ny * 0.6 + wy * 0.7) * spine, (nz * 0.6 + wz * 0.7) * spine);
              const cy = sy((nx * 0.6 + wx * 0.7) * spine, (ny * 0.6 + wy * 0.7) * spine, (nz * 0.6 + wz * 0.7) * spine);
              for (let k = 0; k < n; k++) {
                const t = (k + (j % 4 ? 0.75 : 0.25)) / n;
                const px = tpScreen[i0 * 2] + (tpScreen[i1 * 2] - tpScreen[i0 * 2]) * t;
                const py = tpScreen[i0 * 2 + 1] + (tpScreen[i1 * 2 + 1] - tpScreen[i0 * 2 + 1]) * t;
                ctx!.moveTo(px, py);
                ctx!.lineTo(px + ax, py + ay);
                ctx!.moveTo(px, py);
                ctx!.lineTo(px + bx, py + by);
                ctx!.moveTo(px, py);
                ctx!.lineTo(px + cx, py + cy);
              }
            }
          }
          ctx!.strokeStyle = pal.spine;
          ctx!.lineWidth = Math.max(ftPx(x, z, 0.02), 0.6);
          ctx!.stroke();
        }
        // The crown of spines at the tip.
        if (to === lb.rings && rPx > 2) {
          const [ax, ay, az] = lb.tip;
          const apex = lc[lb.rings];
          ctx!.beginPath();
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2;
            // Splayed round the tip's line, out of its plane and across it.
            const qx = ay * Math.cos(a);
            const qy = -ax * Math.cos(a);
            const qz = Math.sin(a);
            const dx = (ax * 0.8 + qx * 0.7) * spine;
            const dy = (ay * 0.8 + qy * 0.7) * spine;
            const dz = (az * 0.8 + qz * 0.7) * spine;
            ctx!.moveTo(apex[0], apex[1]);
            ctx!.lineTo(apex[0] + sx(dx, dy, dz), apex[1] + sy(dx, dy, dz));
          }
          ctx!.strokeStyle = pal.tuft;
          ctx!.lineWidth = Math.max(ftPx(x, z, 0.025), 0.7);
          ctx!.stroke();
        }
      }
      ctx!.lineCap = "butt";
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the trees are.
    type TotemPlant = {
      /** the core's rings, foot to shoulder — centre (x, y, z) and radius —
       *  then its apex */
      core: Float32Array;
      /** each knob's centre, then its three half-axes as (x, y, z) vectors:
       *  across, along its drip, and out */
      k: Float32Array;
      /** each knob's outward normal across the ground, and whether it's on
       *  the top, where it always shows */
      out: Float32Array;
      top: Uint8Array;
      /** each knob's tones: its face, its shoulder */
      tone: Uint8Array;
      /** the point on each knob that faces the light, as an (x, y, z) shift
       *  from its centre — its shoulder is drawn toward it */
      lift: Float32Array;
    };
    const TT_LEVELS = 8;
    const TT_TONES = [TOTEM_COLOURS, TOTEM_GOLD].map((pal) =>
      Array.from({ length: TT_LEVELS }, (_, i) => {
        const t = i / (TT_LEVELS - 1);
        return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
      }),
    );
    // The model in its own measure (its height = 1). The stem leans a
    // little from foot to top, and its knobs reach this far out at each
    // height — widest low down, where it's oldest, rounding over on top.
    const TT_FOOT = [-0.03, 0.04];
    const TT_TOP = [0.02, -0.02];
    const TT_REACH = [
      [0, 0.15],
      [0.3, 0.145],
      [0.6, 0.135],
      [0.86, 0.135],
    ];
    const ttReach = (y: number) => {
      if (y >= 0.86) return 0.135 * Math.sqrt(Math.max(0, 1 - ((y - 0.86) / 0.14) ** 2));
      let i = 0;
      while (y > TT_REACH[i + 1][0]) i++;
      const [y0, r0] = TT_REACH[i];
      const [y1, r1] = TT_REACH[i + 1];
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    };
    // Its knobs, the same on every plant as they are in the headset. Five
    // ribs run up the stem, a little twisted, each a chain of long knobs
    // like drips of wax, every one swelling out at its foot over the next;
    // smaller ones sit deeper in the grooves between. On top, five lobes
    // on the ribs lie out over the shoulder — the star the model shows
    // from above, wider than the stem — round a small dome.
    // Each is [height, angle, half-width, half-length, depth, droop, kind,
    // a tone up or down, how far in it sits, a sideways tilt]: kind 0 a
    // knob, 1 a crown lobe, 2 the dome.
    const TT_KNOBS: number[][] = (() => {
      const rng = rngFor("totem-pole");
      const out: number[][] = [];
      const shift = () => [-1, 0, 0, 1][(rng() * 4) | 0];
      for (let rib = 0; rib < 10; rib++) {
        const groove = rib % 2;
        let y = 0.05 + rng() * 0.05 + groove * 0.06;
        while (y < (groove ? 0.74 : 0.8)) {
          const s = 0.65 + rng() * 0.7;
          const long = 1.5 + rng() * 1.1;
          out.push([
            y,
            0.3 + (rib / 10) * Math.PI * 2 + y * 0.15 + (rng() - 0.5) * (groove ? 0.5 : 0.3),
            (groove ? 0.036 : 0.05) * s,
            (groove ? 0.036 : 0.05) * s * long,
            groove ? 0.026 : 0.04,
            0.35,
            0,
            shift() - groove,
            groove ? 0.045 : 0,
            (rng() - 0.5) * 0.8,
          ]);
          y += (groove ? 0.14 : 0.13) * (0.75 + rng() * 0.5);
        }
      }
      for (let i = 0; i < 5; i++) {
        out.push([0.86, 0.3 + (i / 5) * Math.PI * 2 + 0.13, 0.06, 0.085, 0.05, 1.8, 1, shift() - 1, 0, 0]);
      }
      out.push([0.92, 0, 0.05, 0.04, 0.05, 0, 2, -1, 0, 0]);
      return out;
    })();
    const TT_N = TT_KNOBS.length;
    const totemGrown = new Map<string, TotemPlant>();
    // Scratch, reused plant to plant: each knob's place on screen, depth,
    // and the order they're drawn in.
    const ttScreen = new Float32Array(TT_N * 2);
    const ttDepth = new Float32Array(TT_N);
    const ttOrder: number[] = [];

    function growTotem(x: number, z: number, h: number, rot: number): TotemPlant {
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const unit = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const level = (n: V3) =>
        Math.max(0, Math.min(TT_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (TT_LEVELS - 1))));
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const turn = (mx: number, mz: number): [number, number] => [mx * cr - mz * sr, mx * sr + mz * cr];
      const axisAt = (y: number): V3 => {
        const [ax, az] = turn(TT_FOOT[0] + (TT_TOP[0] - TT_FOOT[0]) * y, TT_FOOT[1] + (TT_TOP[1] - TT_FOOT[1]) * y);
        return [x + ax * h, y * h, z + az * h];
      };

      const core = new Float32Array(5 * 4);
      [0.02, 0.3, 0.6, 0.84].forEach((y, i) => {
        core.set([...axisAt(y), (ttReach(y) - 0.04) * h], i * 4);
      });
      core.set([...axisAt(0.96), 0], 16);

      const k = new Float32Array(TT_N * 12);
      const out = new Float32Array(TT_N * 2);
      const top = new Uint8Array(TT_N);
      const tone = new Uint8Array(TT_N * 2);
      const lift = new Float32Array(TT_N * 3);
      TT_KNOBS.forEach(([y, ang, a, b, c, droop, kind, jog, sunk, tilt], i) => {
        const [nx, nz] = turn(Math.cos(ang), Math.sin(ang));
        const t: V3 = [-nz, 0, nx];
        let face: V3;
        let centre: V3;
        if (kind === 2) {
          face = [0, 1, 0];
          centre = axisAt(y);
          const A: V3[] = [
            [a, 0, 0],
            [0, b, 0],
            [0, 0, c],
          ];
          k.set([...centre, ...A[0].map((v) => v * h), ...A[1].map((v) => v * h), ...A[2].map((v) => v * h)], i * 12);
        } else {
          // Along the drip, its foot swung out; a crown lobe lies out over
          // the shoulder, its tip dipping.
          let along = unit([-droop * nx + tilt * t[0], 1, -droop * nz + tilt * t[2]]);
          if (kind === 1) along = [-along[0], -along[1], -along[2]];
          // Square to the drip, out of the stem.
          const dn = along[0] * nx + along[2] * nz;
          let out3 = unit([nx - dn * along[0], -dn * along[1], nz - dn * along[2]]);
          if (kind === 1) out3 = unit([nx * 0.3, 1, nz * 0.3]);
          face = kind === 1 ? unit([nx * 0.6, 1, nz * 0.6]) : out3;
          const r = kind === 1 ? 0.085 : ttReach(y) - c * 0.9 - sunk;
          const ax = axisAt(y);
          centre = [ax[0] + nx * r * h, ax[1], ax[2] + nz * r * h];
          k.set(
            [
              ...centre,
              t[0] * a * h, 0, t[2] * a * h,
              along[0] * b * h, along[1] * b * h, along[2] * b * h,
              out3[0] * c * h, out3[1] * c * h, out3[2] * c * h,
            ],
            i * 12,
          );
        }
        out[i * 2] = nx;
        out[i * 2 + 1] = nz;
        top[i] = kind ? 1 : 0;
        const mid = Math.max(0, Math.min(TT_LEVELS - 1, level(face) + jog));
        tone[i * 2] = mid;
        tone[i * 2 + 1] = Math.min(TT_LEVELS - 1, mid + 1);
        // The point on the knob facing the light: through its half-axes,
        // as a sphere's would be.
        const M = [k.subarray(i * 12 + 3, i * 12 + 6), k.subarray(i * 12 + 6, i * 12 + 9), k.subarray(i * 12 + 9, i * 12 + 12)];
        const w = M.map((m) => m[0] * LX + m[1] * LY + m[2] * LZ);
        const wl = Math.hypot(w[0], w[1], w[2]) || 1;
        for (let d = 0; d < 3; d++) lift[i * 3 + d] = (M[0][d] * w[0] + M[1][d] * w[1] + M[2][d] * w[2]) / wl;
      });
      return { core, k, out, top, tone, lift };
    }

    /** Totem pole cactus, after the app's model.
     *
     *  One young stem and not a spine on it: a leaning column of rounded
     *  knobs on five rough ribs, stacked like drips of wax, each swelling
     *  out at its foot over the one below — and on top, five lobes lying
     *  out over the shoulder in a star, round a small dome. The scan's pale
     *  yellow-sage, the creases between the knobs deep olive.
     *
     *  Drawn as the column's core, dark, then every knob on the near side,
     *  far first: an ellipsoid through the local map is an ellipse, so each
     *  is the shadow it casts just below it, itself in one tone, and — big
     *  enough to see it — a lit shoulder. Grown once and cached.
     */
    function drawTotemBody(x: number, z: number, h: number, rot: number, sel: boolean) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = totemGrown.get(key);
      if (!grown) {
        if (totemGrown.size > 400) totemGrown.clear(); // growth and edits mint new keys
        grown = growTotem(x, z, h, rot);
        totemGrown.set(key, grown);
      }
      const { core, k, out, top, tone, lift } = grown;
      const pal = sel ? TOTEM_GOLD : TOTEM_COLOURS;
      const tones = TT_TONES[sel ? 1 : 0];

      // The local map from feet to pixels, at half height: a stem this
      // small doesn't bend it.
      const m = P(x, h * 0.5, z);
      const mx = P(x + 1, h * 0.5, z);
      const my = P(x, h * 0.5 + 1, z);
      const mz = P(x, h * 0.5, z + 1);
      const J0 = mx[0] - m[0];
      const J1 = mx[1] - m[1];
      const J2 = my[0] - m[0];
      const J3 = my[1] - m[1];
      const J4 = mz[0] - m[0];
      const J5 = mz[1] - m[1];
      const hPx = Math.hypot(J2, J3) * h;

      // The core, filled dark: what shows in the creases.
      const hullPts: [number, number][] = [];
      for (let i = 0; i < 4; i++) {
        const q = P(core[i * 4], core[i * 4 + 1], core[i * 4 + 2]);
        const r = core[i * 4 + 3];
        for (let j = 0; j < 12; j++) {
          const ox = Math.cos((j * Math.PI) / 6) * r;
          const oz = Math.sin((j * Math.PI) / 6) * r;
          hullPts.push([q[0] + J0 * ox + J4 * oz, q[1] + J1 * ox + J5 * oz]);
        }
      }
      const apex = P(core[16], core[17], core[18]);
      hullPts.push([apex[0], apex[1]]);
      const hull = convexHull(hullPts);
      if (hull.length > 2) {
        ctx!.beginPath();
        ctx!.moveTo(hull[0][0], hull[0][1]);
        for (let i = 1; i < hull.length; i++) ctx!.lineTo(hull[i][0], hull[i][1]);
        ctx!.closePath();
        ctx!.fillStyle = pal.crease;
        ctx!.fill();
      }

      // The knobs that face the eye, and those just round the edge that
      // make its lumpy outline.
      ttOrder.length = 0;
      for (let i = 0; i < TT_N; i++) {
        const cx = k[i * 12];
        const cy = k[i * 12 + 1];
        const cz = k[i * 12 + 2];
        if (!top[i]) {
          const vx = eye[0] - cx;
          const vz = eye[2] - cz;
          const vl = Math.hypot(vx, eye[1] - cy, vz) || 1;
          if ((out[i * 2] * vx + out[i * 2 + 1] * vz) / vl < -0.25) continue;
        }
        const q = P(cx, cy, cz);
        ttScreen[i * 2] = q[0];
        ttScreen[i * 2 + 1] = q[1];
        ttDepth[i] = q[2];
        ttOrder.push(i);
      }
      ttOrder.sort((a, b) => ttDepth[b] - ttDepth[a]);

      const layers = hPx > 70 ? 3 : hPx > 24 ? 2 : 1;
      let cur = -1;
      const blob = (cx: number, cy: number, rx: number, ry: number, ang: number, t: number) => {
        if (t !== cur) {
          ctx!.fillStyle = tones[t];
          cur = t;
        }
        ctx!.beginPath();
        ctx!.ellipse(cx, cy, rx, ry, ang, 0, Math.PI * 2);
        ctx!.fill();
      };
      for (const i of ttOrder) {
        const b = i * 12 + 3;
        // An ellipsoid through the local (affine) map is an ellipse.
        const ax0 = J0 * k[b] + J2 * k[b + 1] + J4 * k[b + 2];
        const ax1 = J0 * k[b + 3] + J2 * k[b + 4] + J4 * k[b + 5];
        const ax2 = J0 * k[b + 6] + J2 * k[b + 7] + J4 * k[b + 8];
        const ay0 = J1 * k[b] + J3 * k[b + 1] + J5 * k[b + 2];
        const ay1 = J1 * k[b + 3] + J3 * k[b + 4] + J5 * k[b + 5];
        const ay2 = J1 * k[b + 6] + J3 * k[b + 7] + J5 * k[b + 8];
        const c11 = ax0 * ax0 + ax1 * ax1 + ax2 * ax2;
        const c22 = ay0 * ay0 + ay1 * ay1 + ay2 * ay2;
        const c12 = ax0 * ay0 + ax1 * ay1 + ax2 * ay2;
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        const rx = Math.sqrt(mid + d);
        const ry = Math.sqrt(Math.max(0, mid - d));
        const ang = 0.5 * Math.atan2(2 * c12, c11 - c22);
        const sx = ttScreen[i * 2];
        const sy = ttScreen[i * 2 + 1];
        if (layers === 1) {
          blob(sx, sy, rx, ry, ang, tone[i * 2]);
          continue;
        }
        // The shadow it casts on the knob below, just under its foot (the
        // dome, last, casts none); then the knob, one tone, so knobs facing
        // the same way run together as the scan's do; then, near enough, a
        // soft shoulder of light.
        if (i < TT_N - 1) {
          if (cur !== -2) {
            ctx!.fillStyle = pal.crease;
            cur = -2;
          }
          const drop = Math.max(Math.abs(k[b + 4]) * 0.3, Math.abs(k[b + 7]) * 0.8);
          ctx!.beginPath();
          ctx!.ellipse(sx - J2 * drop, sy - J3 * drop, rx * 0.9, ry * 0.9, ang, 0, Math.PI * 2);
          ctx!.fill();
        }
        blob(sx, sy, rx, ry, ang, tone[i * 2]);
        if (layers === 3) {
          const lx = J0 * lift[i * 3] + J2 * lift[i * 3 + 1] + J4 * lift[i * 3 + 2];
          const ly = J1 * lift[i * 3] + J3 * lift[i * 3 + 1] + J5 * lift[i * 3 + 2];
          blob(sx + lx * 0.32, sy + ly * 0.32, rx * 0.62, ry * 0.62, ang, tone[i * 2 + 1]);
        }
      }
    }

    // Grown once per plant and kept, as the trees are.
    type MadagascarPlant = {
      /** the trunk's ring centres, foot to neck, and its rings' points as
       *  offsets, and each face's outward normal and tone */
      axis: Float32Array;
      ring: Float32Array;
      faceN: Float32Array;
      faceTone: Uint8Array;
      /** spines on the trunk: where each sits, and which way it points */
      spines: Float32Array;
      /** the heart of the crown, where the leaves meet */
      heart: [number, number, number];
      /** each leaf's centre line and the half-width across it, as (x, y, z)
       *  pairs, point by point; its middle; the normal of its upper face;
       *  and its tone seen from above and from below */
      leaf: Float32Array;
      mid: Float32Array;
      leafN: Float32Array;
      leafTone: Uint8Array;
    };
    const MP_LEVELS = 8;
    const MP_SIDES = 10;
    const MP_PTS = 7;
    const MP_LEAVES = 96;
    const MP_SPINES = 160;
    const mpRamp = (lo: number[], hi: number[]) =>
      Array.from({ length: MP_LEVELS }, (_, i) => {
        const t = i / (MP_LEVELS - 1);
        return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
      });
    // Leaf tones over, then under, then the bark's — the sheet's and gold.
    const MP_TONES = [MADAGASCAR_COLOURS, MADAGASCAR_GOLD].map((pal) => [
      ...mpRamp(pal.shade, pal.lit),
      ...mpRamp(pal.under, pal.underLit),
      ...mpRamp(pal.bark, pal.barkLit),
    ]);
    // The model in its own measure (its height = 1): the trunk leans from
    // its foot to the neck where the leaves begin, thick and tapering, and
    // the crown's heart sits just above, over the bounding box's middle.
    const MP_FOOT = [0.06, 0.055];
    const MP_NECK = [0.012, 0.02];
    const MP_RINGS = [
      [0, 0.05],
      [0.14, 0.046],
      [0.28, 0.041],
      [0.42, 0.037],
      [0.56, 0.035],
    ];
    const MP_HEART = [0.005, 0.56, 0.01];
    // Where a leaf is along its length, and how wide: a narrow foot, a long
    // strap, a rounded point.
    const MP_ALONG = [0, 0.15, 0.35, 0.55, 0.75, 0.9, 1];
    const MP_WIDE = [0.3, 0.9, 1, 1, 0.95, 0.7, 0.15];
    // The leaves, the same on every plant as in the headset: a spiral up
    // the neck, the oldest at the bottom hanging down the trunk, the middle
    // ones arching out and drooping at the tips, the youngest standing up
    // out of the top. Each as its centre line and half-width, point by
    // point, in the model's measure.
    const MP_LEAF = (() => {
      const rng = rngFor("madagascar-palm");
      const out = new Float32Array(MP_LEAVES * MP_PTS * 6);
      const deg = Math.PI / 180;
      for (let i = 0; i < MP_LEAVES; i++) {
        const t = (i + 0.5) / MP_LEAVES;
        const az = i * 2.39996 + (rng() - 0.5) * 0.3;
        const dx = Math.cos(az);
        const dz = Math.sin(az);
        const sx = -dz;
        const sz = dx;
        const rise = (-55 + 135 * Math.pow(t, 0.85) + (rng() - 0.5) * 24) * deg;
        const bend = (0.55 + 0.8 * (1 - t)) * (0.7 + 0.6 * rng());
        const tip = Math.max(rise - bend, -85 * deg);
        // The oldest, hanging, are the shortest left.
        const len = 0.36 * (0.85 + 0.3 * rng()) * (t < 0.25 ? 0.7 + 1.2 * t : 1);
        const hw = 0.026 * (0.85 + 0.3 * rng());
        const tw0 = (rng() - 0.5) * 1.0;
        const tw1 = (rng() - 0.5) * 0.8;
        let px = MP_HEART[0] + dx * 0.035;
        let py = 0.46 + 0.2 * t;
        let pz = MP_HEART[2] + dz * 0.035;
        let prev = 0;
        for (let j = 0; j < MP_PTS; j++) {
          const sAt = MP_ALONG[j];
          if (j > 0) {
            // Along the stretch since the last point, at its middle angle.
            const sm = (prev + sAt) / 2;
            const th = rise + (tip - rise) * Math.pow(sm, 1.5);
            const step = (sAt - prev) * len;
            px += dx * Math.cos(th) * step;
            py += Math.sin(th) * step;
            pz += dz * Math.cos(th) * step;
          }
          prev = sAt;
          const th = rise + (tip - rise) * Math.pow(sAt, 1.5);
          // Across the leaf, twisted a little along it; up off it, the
          // normal of its upper face before the twist.
          const tw = tw0 + tw1 * sAt;
          const ux = -Math.sin(th) * dx;
          const uy = Math.cos(th);
          const uz = -Math.sin(th) * dz;
          const w = hw * MP_WIDE[j];
          const o = (i * MP_PTS + j) * 6;
          out[o] = px;
          out[o + 1] = py;
          out[o + 2] = pz;
          out[o + 3] = (sx * Math.cos(tw) + ux * Math.sin(tw)) * w;
          out[o + 4] = uy * Math.sin(tw) * w;
          out[o + 5] = (sz * Math.cos(tw) + uz * Math.sin(tw)) * w;
        }
      }
      return out;
    })();
    // Spines up the trunk on a spiral: each one's height and angle.
    const MP_SPINE_AT = (() => {
      const rng = rngFor("madagascar-spines");
      const out = new Float32Array(MP_SPINES * 2);
      for (let i = 0; i < MP_SPINES; i++) {
        out[i * 2] = 0.02 + 0.4 * (i / MP_SPINES) + (rng() - 0.5) * 0.01;
        out[i * 2 + 1] = i * 2.39996 + (rng() - 0.5) * 0.4;
      }
      return out;
    })();
    const madagascarGrown = new Map<string, MadagascarPlant>();
    // Scratch, reused plant to plant.
    const mpScreen = new Float32Array(MP_RINGS.length * MP_SIDES * 2);
    const mpBuckets: number[][] = Array.from({ length: MP_LEVELS }, () => []);
    const mpOrder: number[] = [];
    const mpDepth = new Float32Array(MP_LEAVES + 2);

    function growMadagascar(x: number, z: number, h: number, rot: number): MadagascarPlant {
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const level = (n: V3) =>
        Math.max(0, Math.min(MP_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (MP_LEVELS - 1))));
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const turnX = (mx: number, mz: number) => mx * cr - mz * sr;
      const turnZ = (mx: number, mz: number) => mx * sr + mz * cr;
      const put = (mx: number, my: number, mz: number): V3 => [x + turnX(mx, mz) * h, my * h, z + turnZ(mx, mz) * h];
      const vec = (mx: number, my: number, mz: number): V3 => [turnX(mx, mz), my, turnZ(mx, mz)];

      // The trunk: rings up the lean, faces shaded once.
      const NR = MP_RINGS.length;
      const axis = new Float32Array(NR * 3);
      const ring = new Float32Array(NR * MP_SIDES * 2);
      MP_RINGS.forEach(([y, r], l) => {
        const f = Math.min(1, y / 0.42);
        axis.set(put(MP_FOOT[0] + (MP_NECK[0] - MP_FOOT[0]) * f, y, MP_FOOT[1] + (MP_NECK[1] - MP_FOOT[1]) * f), l * 3);
        for (let j = 0; j < MP_SIDES; j++) {
          const a = rot + (j * Math.PI * 2) / MP_SIDES;
          ring[(l * MP_SIDES + j) * 2] = Math.cos(a) * r * h;
          ring[(l * MP_SIDES + j) * 2 + 1] = Math.sin(a) * r * h;
        }
      });
      const faceN = new Float32Array((NR - 1) * MP_SIDES * 3);
      const faceTone = new Uint8Array((NR - 1) * MP_SIDES);
      for (let b = 0; b < NR - 1; b++) {
        const taper = (MP_RINGS[b][1] - MP_RINGS[b + 1][1]) / (MP_RINGS[b + 1][0] - MP_RINGS[b][0]);
        for (let j = 0; j < MP_SIDES; j++) {
          const a = rot + ((j + 0.5) * Math.PI * 2) / MP_SIDES;
          const l = Math.hypot(1, taper);
          const n: V3 = [Math.cos(a) / l, taper / l, Math.sin(a) / l];
          faceN.set(n, (b * MP_SIDES + j) * 3);
          faceTone[b * MP_SIDES + j] = level(n);
        }
      }
      // Its spines, each standing out of the bark where it sits.
      const spines = new Float32Array(MP_SPINES * 6);
      for (let i = 0; i < MP_SPINES; i++) {
        const y = MP_SPINE_AT[i * 2];
        const a = MP_SPINE_AT[i * 2 + 1] + rot;
        const f = Math.min(1, y / 0.42);
        const r = 0.05 + (0.037 - 0.05) * f;
        const c = put(MP_FOOT[0] + (MP_NECK[0] - MP_FOOT[0]) * f, y, MP_FOOT[1] + (MP_NECK[1] - MP_FOOT[1]) * f);
        spines.set([c[0] + Math.cos(a) * r * h, c[1], c[2] + Math.sin(a) * r * h, Math.cos(a), 0.35, Math.sin(a)], i * 6);
      }

      // The leaves, turned and scaled, each with its upper face's normal.
      const leaf = new Float32Array(MP_LEAVES * MP_PTS * 6);
      const mid = new Float32Array(MP_LEAVES * 3);
      const leafN = new Float32Array(MP_LEAVES * 3);
      const leafTone = new Uint8Array(MP_LEAVES * 2);
      for (let i = 0; i < MP_LEAVES; i++) {
        for (let j = 0; j < MP_PTS; j++) {
          const o = (i * MP_PTS + j) * 6;
          leaf.set(put(MP_LEAF[o], MP_LEAF[o + 1], MP_LEAF[o + 2]), o);
          const w = vec(MP_LEAF[o + 3], MP_LEAF[o + 4], MP_LEAF[o + 5]);
          leaf.set([w[0] * h, w[1] * h, w[2] * h], o + 3);
        }
        const a = (i * MP_PTS + 2) * 6;
        const b = (i * MP_PTS + 4) * 6;
        mid.set([leaf[(i * MP_PTS + 3) * 6], leaf[(i * MP_PTS + 3) * 6 + 1], leaf[(i * MP_PTS + 3) * 6 + 2]], i * 3);
        // Up off the leaf: across it, crossed with along it.
        const tx = leaf[b] - leaf[a];
        const ty = leaf[b + 1] - leaf[a + 1];
        const tz = leaf[b + 2] - leaf[a + 2];
        const wx = leaf[(i * MP_PTS + 3) * 6 + 3];
        const wy = leaf[(i * MP_PTS + 3) * 6 + 4];
        const wz = leaf[(i * MP_PTS + 3) * 6 + 5];
        let n: V3 = [wy * tz - wz * ty, wz * tx - wx * tz, wx * ty - wy * tx];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        n = [n[0] / nl, n[1] / nl, n[2] / nl];
        leafN.set(n, i * 3);
        leafTone[i * 2] = level(n);
        leafTone[i * 2 + 1] = MP_LEVELS + level([-n[0], -n[1], -n[2]]);
      }
      return { axis, ring, faceN, faceTone, spines, heart: put(MP_HEART[0], MP_HEART[1], MP_HEART[2]), leaf, mid, leafN, leafTone };
    }

    /** Madagascar palm, after the app's model.
     *
     *  No palm at all: a thick grey-brown trunk, tapering and leaning a
     *  little, studded with pale spines, and on top a shaggy fountain of
     *  long strap leaves — the youngest standing up out of the middle, the
     *  rest arching out and drooping at their tips, the oldest hanging down
     *  the trunk. Yellow-green on top with a pale midrib, duller beneath.
     *
     *  The trunk, the dark heart of the crown and every leaf are drawn far
     *  to near, so a hanging leaf behind the trunk stays behind it. The
     *  trunk is a ring of shaded faces with, close up, its spines; a leaf
     *  is a twisted ribbon in one tone — its upper face's or its under
     *  face's, whichever shows — and, big enough to see, its midrib.
     *  Grown once and cached; the leaves placed by the local map at the
     *  crown, which a plant this size doesn't bend.
     */
    function drawMadagascarBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = madagascarGrown.get(key);
      if (!grown) {
        if (madagascarGrown.size > 400) madagascarGrown.clear(); // growth and edits mint new keys
        grown = growMadagascar(x, z, h, rot);
        madagascarGrown.set(key, grown);
      }
      const { axis, ring, faceN, faceTone, spines, heart, leaf, mid, leafN, leafTone } = grown;
      const pal = sel ? MADAGASCAR_GOLD : MADAGASCAR_COLOURS;
      const tones = MP_TONES[sel ? 1 : 0];
      const NR = MP_RINGS.length;

      // The local map at the heart: screen x, y and depth per foot.
      const q = P(heart[0], heart[1], heart[2]);
      const qx = P(heart[0] + 1, heart[1], heart[2]);
      const qy = P(heart[0], heart[1] + 1, heart[2]);
      const qz = P(heart[0], heart[1], heart[2] + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const footPx = Math.hypot(J[1], J[4]);

      // Far to near: each leaf by its middle, the trunk by its own, the
      // heart by its.
      mpOrder.length = 0;
      for (let i = 0; i < MP_LEAVES; i++) {
        const dx = mid[i * 3] - heart[0];
        const dy = mid[i * 3 + 1] - heart[1];
        const dz = mid[i * 3 + 2] - heart[2];
        mpDepth[i] = q[2] + J[6] * dx + J[7] * dy + J[8] * dz;
        mpOrder.push(i);
      }
      mpDepth[MP_LEAVES] = P(axis[3], axis[4], axis[5])[2];
      mpOrder.push(MP_LEAVES);
      mpDepth[MP_LEAVES + 1] = q[2];
      mpOrder.push(MP_LEAVES + 1);
      mpOrder.sort((a, b) => mpDepth[b] - mpDepth[a]);

      const midribs = footPx * h > 90;
      const sxOf = (px: number, py: number, pz: number) =>
        q[0] + J[0] * (px - heart[0]) + J[1] * (py - heart[1]) + J[2] * (pz - heart[2]);
      const syOf = (px: number, py: number, pz: number) =>
        q[1] + J[3] * (px - heart[0]) + J[4] * (py - heart[1]) + J[5] * (pz - heart[2]);

      for (const it of mpOrder) {
        if (it === MP_LEAVES) {
          // The trunk: its outline dark, then each face toward the eye.
          const lc: [number, number, number][] = [];
          for (let l = 0; l < NR; l++) lc.push(P(axis[l * 3], axis[l * 3 + 1], axis[l * 3 + 2]));
          const jx0 = qx[0] - q[0];
          const jx1 = qx[1] - q[1];
          const jz0 = qz[0] - q[0];
          const jz1 = qz[1] - q[1];
          for (let l = 0; l < NR; l++) {
            for (let j = 0; j < MP_SIDES; j++) {
              const k2 = (l * MP_SIDES + j) * 2;
              mpScreen[k2] = lc[l][0] + jx0 * ring[k2] + jz0 * ring[k2 + 1];
              mpScreen[k2 + 1] = lc[l][1] + jx1 * ring[k2] + jz1 * ring[k2 + 1];
            }
          }
          const hull = convexHull(Array.from({ length: NR * MP_SIDES }, (_, k): [number, number] => [mpScreen[k * 2], mpScreen[k * 2 + 1]]));
          if (hull.length > 2) {
            ctx!.beginPath();
            ctx!.moveTo(hull[0][0], hull[0][1]);
            for (let k = 1; k < hull.length; k++) ctx!.lineTo(hull[k][0], hull[k][1]);
            ctx!.closePath();
            ctx!.fillStyle = tones[2 * MP_LEVELS];
            ctx!.fill();
          }
          let vx = eye[0] - axis[6];
          let vy = eye[1] - axis[7];
          let vz = eye[2] - axis[8];
          const vl = Math.hypot(vx, vy, vz) || 1;
          vx /= vl;
          vy /= vl;
          vz /= vl;
          for (const bucket of mpBuckets) bucket.length = 0;
          for (let f = 0; f < (NR - 1) * MP_SIDES; f++) {
            if (faceN[f * 3] * vx + faceN[f * 3 + 1] * vy + faceN[f * 3 + 2] * vz > 0) mpBuckets[faceTone[f]].push(f);
          }
          mpBuckets.forEach((faces, t) => {
            if (!faces.length) return;
            ctx!.beginPath();
            for (const f of faces) {
              const b = (f / MP_SIDES) | 0;
              const j = f % MP_SIDES;
              const j1 = (j + 1) % MP_SIDES;
              ctx!.moveTo(mpScreen[(b * MP_SIDES + j) * 2], mpScreen[(b * MP_SIDES + j) * 2 + 1]);
              ctx!.lineTo(mpScreen[(b * MP_SIDES + j1) * 2], mpScreen[(b * MP_SIDES + j1) * 2 + 1]);
              ctx!.lineTo(mpScreen[((b + 1) * MP_SIDES + j1) * 2], mpScreen[((b + 1) * MP_SIDES + j1) * 2 + 1]);
              ctx!.lineTo(mpScreen[((b + 1) * MP_SIDES + j) * 2], mpScreen[((b + 1) * MP_SIDES + j) * 2 + 1]);
              ctx!.closePath();
            }
            ctx!.fillStyle = tones[2 * MP_LEVELS + t];
            ctx!.fill();
          });
          // Spines, close up: short pale points on the side toward the eye.
          if (footPx * 0.05 * h > 4) {
            const len = 0.014 * h;
            ctx!.beginPath();
            for (let i = 0; i < MP_SPINES; i++) {
              const o = i * 6;
              if (spines[o + 3] * vx + spines[o + 5] * vz < 0.1) continue;
              const a = P(spines[o], spines[o + 1], spines[o + 2]);
              ctx!.moveTo(a[0], a[1]);
              ctx!.lineTo(
                a[0] + (J[0] * spines[o + 3] + J[1] * spines[o + 4] + J[2] * spines[o + 5]) * len,
                a[1] + (J[3] * spines[o + 3] + J[4] * spines[o + 4] + J[5] * spines[o + 5]) * len,
              );
            }
            ctx!.strokeStyle = pal.spine;
            ctx!.lineWidth = Math.max(footPx * 0.005 * h, 0.6);
            ctx!.stroke();
          }
        } else if (it === MP_LEAVES + 1) {
          // The heart, where the leaf bases crowd: dark.
          const r = 0.07 * h;
          ctx!.beginPath();
          ctx!.ellipse(q[0], q[1], Math.hypot(J[0], J[3]) * r, Math.hypot(J[1], J[4]) * r * 1.6, 0, 0, Math.PI * 2);
          ctx!.fillStyle = pal.heart;
          ctx!.fill();
        } else {
          const i = it;
          const o0 = i * MP_PTS * 6;
          // Which face shows: up off the leaf, toward the eye or away.
          const up =
            leafN[i * 3] * (eye[0] - mid[i * 3]) +
              leafN[i * 3 + 1] * (eye[1] - mid[i * 3 + 1]) +
              leafN[i * 3 + 2] * (eye[2] - mid[i * 3 + 2]) >
            0;
          ctx!.beginPath();
          for (let j = 0; j < MP_PTS; j++) {
            const o = o0 + j * 6;
            const cx = sxOf(leaf[o], leaf[o + 1], leaf[o + 2]);
            const cy = syOf(leaf[o], leaf[o + 1], leaf[o + 2]);
            const wx = J[0] * leaf[o + 3] + J[1] * leaf[o + 4] + J[2] * leaf[o + 5];
            const wy = J[3] * leaf[o + 3] + J[4] * leaf[o + 4] + J[5] * leaf[o + 5];
            if (j === 0) ctx!.moveTo(cx + wx, cy + wy);
            else ctx!.lineTo(cx + wx, cy + wy);
          }
          for (let j = MP_PTS - 1; j >= 0; j--) {
            const o = o0 + j * 6;
            const cx = sxOf(leaf[o], leaf[o + 1], leaf[o + 2]);
            const cy = syOf(leaf[o], leaf[o + 1], leaf[o + 2]);
            const wx = J[0] * leaf[o + 3] + J[1] * leaf[o + 4] + J[2] * leaf[o + 5];
            const wy = J[3] * leaf[o + 3] + J[4] * leaf[o + 4] + J[5] * leaf[o + 5];
            ctx!.lineTo(cx - wx, cy - wy);
          }
          ctx!.closePath();
          ctx!.fillStyle = tones[leafTone[i * 2 + (up ? 0 : 1)]];
          ctx!.fill();
          if (midribs && up) {
            ctx!.beginPath();
            for (let j = 1; j < MP_PTS - 1; j++) {
              const o = o0 + j * 6;
              const cx = sxOf(leaf[o], leaf[o + 1], leaf[o + 2]);
              const cy = syOf(leaf[o], leaf[o + 1], leaf[o + 2]);
              if (j === 1) ctx!.moveTo(cx, cy);
              else ctx!.lineTo(cx, cy);
            }
            ctx!.strokeStyle = pal.midrib;
            ctx!.lineWidth = Math.max(footPx * 0.004 * h, 0.6);
            ctx!.stroke();
          }
        }
      }
      ctx!.lineWidth = lw;
    }

    // The firestick's sticks, the same on every plant as in the headset,
    // in the model's measure (its height = 1): a pale leader the whole
    // height; low down, branches spreading wide and forking, and forking
    // again, each fork turning further up, into a coral of upturned sticks;
    // higher, shorter branches held more upright, so the top is narrow.
    // Each stick is [x0, y0, z0, x1, y1, z1, width, colour], its colour 0
    // the old wood, 1 straw, 2 the young green.
    const FS_STICKS: number[][] = (() => {
      const rng = rngFor("firestick");
      const out: number[][] = [];
      const widths = [0.019, 0.015, 0.012, 0.0095, 0.008];
      type V3 = [number, number, number];
      const unit = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const colourAt = (y: number, order: number) =>
        order === 0 && y < 0.3 ? 0 : rng() < Math.max(0, Math.min(1, (y - 0.5) / 0.35)) * 0.75 ? 2 : 1;
      const fork = (p: V3, d: V3, len: number, order: number, last: number, lift: number) => {
        const e: V3 = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
        out.push([...p, ...e, widths[Math.min(order, 4)], colourAt(e[1], order)]);
        // Some stop short, as the scan's do.
        if (order >= last || (order >= 2 && rng() < 0.12)) return;
        // Two ways on (now and then three), splayed across the stick and
        // turned up.
        const side = unit([-d[2], 0, d[0]]);
        const n = rng() < 0.2 ? 3 : 2;
        const roll = rng() * Math.PI;
        for (let k = 0; k < n; k++) {
          const a = roll + (k * Math.PI * 2) / n;
          const spread = (0.3 + rng() * 0.45) * (order === 0 ? 1.1 : 0.9);
          const across: V3 = [side[0] * Math.cos(a), Math.sin(a) * 0.6, side[2] * Math.cos(a)];
          const nd = unit([d[0] + across[0] * spread, d[1] + across[1] * spread + lift, d[2] + across[2] * spread]);
          fork(e, nd, len * (0.55 + rng() * 0.35), order + 1, last, lift);
        }
      };
      // The leader, leaning a touch as it climbs, forking at its top.
      let at: V3 = [0, 0, 0];
      for (let k = 0; k < 5; k++) {
        const next: V3 = [at[0] + (rng() - 0.5) * 0.02, (k + 1) * 0.17, at[2] + (rng() - 0.5) * 0.02];
        out.push([...at, ...next, 0.028 - k * 0.0022, k < 3 ? 0 : 1]);
        at = next;
      }
      fork(at, [0, 1, 0], 0.08, 1, 3, 0.3);
      const leaderAt = (y: number): V3 => {
        for (const st of out.slice(0, 5)) {
          if (y <= st[4]) {
            const f = (y - st[1]) / (st[4] - st[1]);
            return [st[0] + (st[3] - st[0]) * f, y, st[2] + (st[5] - st[2]) * f];
          }
        }
        return at;
      };
      // The low branches: out nearly flat from the foot, then forking
      // four deep, each fork turning up.
      for (let i = 0; i < 16; i++) {
        const y = 0.03 + (i / 15) * 0.37 + (rng() - 0.5) * 0.03;
        const az = i * 2.39996 + (rng() - 0.5) * 0.4;
        const el = (12 + rng() * 22 + (y / 0.4) * 10) * (Math.PI / 180);
        fork(leaderAt(y), [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], 0.12 + rng() * 0.05, 0, 4, 0.32);
      }
      // The high ones: shorter, steeper, crowding into an upright head.
      for (let i = 0; i < 16; i++) {
        const y = 0.42 + (i / 15) * 0.45 + (rng() - 0.5) * 0.03;
        const az = 1.3 + i * 2.39996 + (rng() - 0.5) * 0.4;
        const el = (50 + rng() * 20) * (Math.PI / 180);
        fork(leaderAt(y), [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], 0.06 + rng() * 0.03, 1, 4, 0.4);
      }
      return out;
    })();
    const FS_N = FS_STICKS.length;
    // Every stick's batch: its width (the leader's own five, then the
    // branches' four), colour and whether it's on the near side.
    const FS_WIDTHS = [...new Set(FS_STICKS.map((st) => st[6]))].sort((a, b) => b - a);
    const FS_BATCH = FS_STICKS.map((st) => FS_WIDTHS.indexOf(st[6]) * 3 + st[7]);
    const FS_BATCHES = FS_WIDTHS.length * 3;
    const fsTones = [FIRESTICK_COLOURS, FIRESTICK_GOLD].map((pal) =>
      [pal.wood, pal.straw, pal.young].map(([lo, hi]) =>
        [0.35, 0.6, 0.9].map((t) => `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`),
      ),
    );
    const firestickGrown = new Map<string, Float32Array>();
    // Scratch: each stick's ends on screen, and each batch's sticks.
    const fsScreen = new Float32Array(FS_N * 4);
    const fsBuckets: number[][] = Array.from({ length: FS_BATCHES * 2 }, () => []);

    /** Firestick, after the app's model.
     *
     *  Pencil sticks and nothing else: a pale leader up the middle; low
     *  down, branches spreading wide and forking and forking again, each
     *  fork turning further up, into a coral of upturned sticks; higher,
     *  shorter branches held upright, so the top is narrow. Straw-tan, the
     *  old wood pale, the young growth up top green — the scan's colours;
     *  it was captured before its sticks turned red.
     *
     *  Drawn as strokes, one per width, colour and side: the far side's
     *  sticks first, darker, then the near side's. Close up, every stick
     *  gets a lit stripe along it, so it reads round. Grown once and
     *  cached; placed by the local map at half height, which a plant this
     *  size doesn't bend.
     */
    function drawFirestickBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = firestickGrown.get(key);
      if (!grown) {
        if (firestickGrown.size > 400) firestickGrown.clear(); // growth and edits mint new keys
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        grown = new Float32Array(FS_N * 6);
        FS_STICKS.forEach((st, i) => {
          for (let e = 0; e < 2; e++) {
            const mx = st[e * 3];
            const mz = st[e * 3 + 2];
            grown!.set([x + (mx * cr - mz * sr) * h, st[e * 3 + 1] * h, z + (mx * sr + mz * cr) * h], i * 6 + e * 3);
          }
        });
        firestickGrown.set(key, grown);
      }
      const tones = fsTones[sel ? 1 : 0];

      const cy = h * 0.5;
      const q = P(x, cy, z);
      const qx = P(x + 1, cy, z);
      const qy = P(x, cy + 1, z);
      const qz = P(x, cy, z + 1);
      const J0 = qx[0] - q[0];
      const J1 = qy[0] - q[0];
      const J2 = qz[0] - q[0];
      const J3 = qx[1] - q[1];
      const J4 = qy[1] - q[1];
      const J5 = qz[1] - q[1];
      // Toward the eye across the ground, to tell the near side.
      const ex = eye[0] - x;
      const ez = eye[2] - z;

      for (const b of fsBuckets) b.length = 0;
      for (let i = 0; i < FS_N; i++) {
        const o = i * 6;
        for (let e = 0; e < 2; e++) {
          const dx = grown[o + e * 3] - x;
          const dy = grown[o + e * 3 + 1] - cy;
          const dz = grown[o + e * 3 + 2] - z;
          fsScreen[i * 4 + e * 2] = q[0] + J0 * dx + J1 * dy + J2 * dz;
          fsScreen[i * 4 + e * 2 + 1] = q[1] + J3 * dx + J4 * dy + J5 * dz;
        }
        const near = (grown[o] + grown[o + 3] - 2 * x) * ex + (grown[o + 2] + grown[o + 5] - 2 * z) * ez >= 0;
        fsBuckets[FS_BATCH[i] + (near ? FS_BATCHES : 0)].push(i);
      }

      const footPx = Math.hypot(J1, J4);
      const round = footPx * h > 150;
      ctx!.lineCap = "round";
      const pass = (side: number, tone: number, scale: number, shift: number) => {
        for (let b = 0; b < FS_BATCHES; b++) {
          const sticks = fsBuckets[b + side * FS_BATCHES];
          if (!sticks.length) continue;
          const w = Math.max(FS_WIDTHS[(b / 3) | 0] * h * footPx, 0.7);
          ctx!.beginPath();
          for (const i of sticks) {
            ctx!.moveTo(fsScreen[i * 4] - w * shift, fsScreen[i * 4 + 1] - w * shift);
            ctx!.lineTo(fsScreen[i * 4 + 2] - w * shift, fsScreen[i * 4 + 3] - w * shift);
          }
          ctx!.strokeStyle = tones[b % 3][tone];
          ctx!.lineWidth = w * scale;
          ctx!.stroke();
        }
      };
      pass(0, 0, 1, 0);
      pass(1, round ? 0 : 1, 1, 0);
      if (round) pass(1, 2, 0.45, 0.18);
      ctx!.lineCap = "butt";
      ctx!.lineWidth = lw;
    }

    // The aloe ferox's leaves, the same on every plant as in the headset, in
    // the model's measure (its height = 1): twenty-two on the golden angle off
    // a short stem, the oldest lowest. The outer ones are held out nearly flat,
    // the middle ones are the longest and rise at about 55°, the youngest
    // stand up in the centre. A leaf is a thick blade, so it is four lines
    // along its length — the fold down its middle, the two margins raised
    // above it into a channel, the keel beneath — and four faces between
    // them: upper left and right, under left and right. Each station holds
    // fold, left margin, right margin, keel, as (x, y, z).
    const AF_LEAVES = 22;
    const AF_ALONG = [0, 0.12, 0.28, 0.46, 0.64, 0.82, 1];
    const AF_PTS = AF_ALONG.length;
    const AF_FACES = AF_LEAVES * 4;
    // Which two lines bound each face, and which margin it shares.
    const AF_FACE_LINES = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ];
    const AF_TEETH = 15; // down each margin
    const AF_DEAD = 8;
    const AF_DEAD_PTS = 5;
    const AF_LEVELS = 8;
    const afRamp = (lo: number[], hi: number[]) =>
      Array.from({ length: AF_LEVELS }, (_, i) => {
        const t = i / (AF_LEVELS - 1);
        return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
      });
    // Upper faces, under faces, dead leaves — the sheet's and gold.
    const AF_TONES = [FEROX_COLOURS, FEROX_GOLD].map((pal) => [
      ...afRamp(pal.upper[0], pal.upper[1]),
      ...afRamp(pal.under[0], pal.under[1]),
      ...afRamp(pal.dead[0], pal.dead[1]),
    ]);
    const AF_MODEL = (() => {
      const rng = rngFor("aloe-ferox");
      const deg = Math.PI / 180;
      const leaf = new Float32Array(AF_LEAVES * AF_PTS * 12);
      // Each tooth: where it sits on the margin, then out to its point, then
      // half its foot along the margin.
      const teeth = new Float32Array(AF_LEAVES * 2 * AF_TEETH * 9);
      const dead = new Float32Array(AF_DEAD * AF_DEAD_PTS * 6);
      let top = 0;
      for (let i = 0; i < AF_LEAVES; i++) {
        const t = i / (AF_LEAVES - 1); // 0 the oldest, outermost; 1 the youngest
        const az = i * 2.39996 + (rng() - 0.5) * 0.3;
        const e0Deg = 12 + 64 * Math.pow(t, 1.1) + (rng() - 0.5) * 10;
        const e0 = e0Deg * deg;
        // Every leaf turns up a little toward its tip.
        const bend = (-10 + (rng() - 0.5) * 10) * deg;
        const len = (0.7 + 0.32 * Math.exp(-(((e0Deg - 57) / 18) ** 2))) * (0.92 + 0.16 * rng());
        const hw = 0.15 * (0.85 + 0.3 * rng()) * (1 - 0.25 * t);
        const sway = (rng() - 0.5) * 16 * deg;
        const r0 = 0.05 * (1 - 0.5 * t);
        let px = Math.cos(az) * r0;
        let py = 0.1 + 0.2 * Math.pow(t, 0.8);
        let pz = Math.sin(az) * r0;
        let prev = 0;
        const frame: number[][] = [];
        for (let j = 0; j < AF_PTS; j++) {
          const s = AF_ALONG[j];
          if (j > 0) {
            // Along the stretch since the last station, at its middle angle.
            const sm = (prev + s) / 2;
            const e = e0 - bend * Math.pow(sm, 1.5);
            const ps = az + sway * sm * sm;
            const step = (s - prev) * len;
            px += Math.cos(e) * Math.cos(ps) * step;
            py += Math.sin(e) * step;
            pz += Math.cos(e) * Math.sin(ps) * step;
          }
          prev = s;
          // Along the leaf; across it, level; and up off its upper face
          // (across × along) — up on a flat leaf, in toward the crown on an
          // upright one.
          const e = e0 - bend * Math.pow(s, 1.5);
          const ps = az + sway * s * s;
          const T = [Math.cos(e) * Math.cos(ps), Math.sin(e), Math.cos(e) * Math.sin(ps)];
          const S = [-Math.sin(ps), 0, Math.cos(ps)];
          const N = [-Math.cos(ps) * Math.sin(e), Math.cos(e), -Math.sin(ps) * Math.sin(e)];
          // Broad at the clasp, tapering the whole way to a sharp point.
          const w = hw * Math.pow(1 - s, 0.6) * (0.85 + 0.15 * Math.min(1, s / 0.12));
          const fold = 0.12 * w;
          const keel = 0.5 * w;
          leaf.set(
            [
              px, py, pz,
              px + S[0] * w + N[0] * fold, py + N[1] * fold, pz + S[2] * w + N[2] * fold,
              px - S[0] * w + N[0] * fold, py + N[1] * fold, pz - S[2] * w + N[2] * fold,
              px - N[0] * keel, py - N[1] * keel, pz - N[2] * keel,
            ],
            (i * AF_PTS + j) * 12,
          );
          frame.push([...T, ...S, ...N]);
          top = Math.max(top, py);
        }
        // Teeth down both margins, hooked a little toward the tip, smaller
        // as the leaf narrows.
        for (let side = 0; side < 2; side++) {
          const sg = side === 0 ? 1 : -1;
          for (let k = 0; k < AF_TEETH; k++) {
            const s = 0.06 + (0.8 * (k + 0.3 + rng() * 0.4)) / AF_TEETH;
            let j = 0;
            while (j < AF_PTS - 2 && AF_ALONG[j + 1] < s) j++;
            const f = (s - AF_ALONG[j]) / (AF_ALONG[j + 1] - AF_ALONG[j]);
            const a = (i * AF_PTS + j) * 12 + 3 + side * 3;
            const b = a + 12;
            const [Tx, Ty, Tz, Sx, , Sz, Nx, Ny, Nz] = frame[j];
            const size = (hw / 0.15) * (1 - 0.55 * s);
            const out = 0.012 * size;
            const foot = 0.007 * size;
            teeth.set(
              [
                leaf[a] + (leaf[b] - leaf[a]) * f,
                leaf[a + 1] + (leaf[b + 1] - leaf[a + 1]) * f,
                leaf[a + 2] + (leaf[b + 2] - leaf[a + 2]) * f,
                (Sx * sg * 0.9 + Nx * 0.2 + Tx * 0.35) * out,
                (Ny * 0.2 + Ty * 0.35) * out,
                (Sz * sg * 0.9 + Nz * 0.2 + Tz * 0.35) * out,
                Tx * foot,
                Ty * foot,
                Tz * foot,
              ],
              ((i * 2 + side) * AF_TEETH + k) * 9,
            );
          }
        }
      }
      // The dead leaves at the foot: narrow, gone brown, curled down to the
      // ground and lying on it. Each as centre and half-width, point by point.
      for (let i = 0; i < AF_DEAD; i++) {
        const az = i * 2.39996 + 0.8 + (rng() - 0.5) * 0.5;
        const e0 = (-30 - rng() * 30) * deg;
        const curl = (20 + rng() * 40) * deg;
        const len = 0.14 + rng() * 0.1;
        const hw = 0.03 * (0.8 + 0.4 * rng());
        const lift = (rng() - 0.5) * 0.6;
        let px = Math.cos(az) * 0.05;
        let py = 0.05 + rng() * 0.05;
        let pz = Math.sin(az) * 0.05;
        for (let j = 0; j < AF_DEAD_PTS; j++) {
          const s = j / (AF_DEAD_PTS - 1);
          if (j > 0) {
            const e = e0 - curl * ((j - 0.5) / (AF_DEAD_PTS - 1));
            const step = len / (AF_DEAD_PTS - 1);
            px += Math.cos(e) * Math.cos(az) * step;
            py = Math.max(0.004, py + Math.sin(e) * step);
            pz += Math.cos(e) * Math.sin(az) * step;
          }
          const w = hw * (1 - 0.7 * s);
          dead.set([px, py, pz, -Math.sin(az) * w, lift * w, Math.cos(az) * w], (i * AF_DEAD_PTS + j) * 6);
        }
      }
      // The tallest leaf tip to the full height.
      const ys = 1 / top;
      for (let k = 1; k < leaf.length; k += 3) leaf[k] *= ys;
      for (let k = 1; k < teeth.length; k += 3) teeth[k] *= ys;
      for (let k = 1; k < dead.length; k += 3) dead[k] *= ys;
      return { leaf, teeth, dead, core: [0, 0.2 * ys, 0] };
    })();

    // Grown once per plant and kept, as the trees are.
    type FeroxPlant = {
      /** the leaves' lines, turned, scaled and placed */
      leaf: Float32Array;
      /** each face's outward normal, its middle and its tone */
      faceN: Float32Array;
      faceMid: Float32Array;
      faceTone: Uint8Array;
      teeth: Float32Array;
      /** the dead leaves as centre and half-width, each one's middle, the
       *  normal of its upper side, and its tone seen from above and below */
      dead: Float32Array;
      deadMid: Float32Array;
      deadN: Float32Array;
      deadTone: Uint8Array;
      core: [number, number, number];
    };
    const feroxGrown = new Map<string, FeroxPlant>();
    // Scratch, reused plant to plant.
    const afOrder: number[] = [];
    const afDepth = new Float32Array(AF_FACES + AF_DEAD + 1);
    const afVis = new Uint8Array(AF_FACES);
    const afDone = new Uint8Array(AF_FACES);

    function growFerox(x: number, z: number, h: number, rot: number): FeroxPlant {
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const level = (n: V3) =>
        Math.max(0, Math.min(AF_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (AF_LEVELS - 1))));
      const unit = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const turn = (src: Float32Array, dst: Float32Array, o: number, offset: boolean) => {
        const mx = src[o];
        const mz = src[o + 2];
        dst[o] = (offset ? x : 0) + (mx * cr - mz * sr) * h;
        dst[o + 1] = src[o + 1] * h;
        dst[o + 2] = (offset ? z : 0) + (mx * sr + mz * cr) * h;
      };

      const leaf = new Float32Array(AF_MODEL.leaf.length);
      for (let o = 0; o < leaf.length; o += 3) turn(AF_MODEL.leaf, leaf, o, true);
      const teeth = new Float32Array(AF_MODEL.teeth.length);
      for (let o = 0; o < teeth.length; o += 9) {
        turn(AF_MODEL.teeth, teeth, o, true);
        turn(AF_MODEL.teeth, teeth, o + 3, false);
        turn(AF_MODEL.teeth, teeth, o + 6, false);
      }
      // Each face lit by its normal a third of the way out, pointed away
      // from the middle of the leaf's section.
      const faceN = new Float32Array(AF_FACES * 3);
      const faceMid = new Float32Array(AF_FACES * 3);
      const faceTone = new Uint8Array(AF_FACES);
      const pt = (i: number, j: number, line: number, k: number) => leaf[(i * AF_PTS + j) * 12 + line * 3 + k];
      for (let i = 0; i < AF_LEAVES; i++) {
        const along: V3 = [0, 1, 2].map((k) => pt(i, 3, 0, k) - pt(i, 1, 0, k)) as V3;
        const middle: V3 = [0, 1, 2].map((k) => pt(i, 2, 0, k) * 0.6 + pt(i, 2, 3, k) * 0.4) as V3;
        for (let f = 0; f < 4; f++) {
          const [la, lb] = AF_FACE_LINES[f];
          const a: V3 = [0, 1, 2].map((k) => pt(i, 2, la, k)) as V3;
          const b: V3 = [0, 1, 2].map((k) => pt(i, 2, lb, k)) as V3;
          const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          let n = unit([along[1] * ac[2] - along[2] * ac[1], along[2] * ac[0] - along[0] * ac[2], along[0] * ac[1] - along[1] * ac[0]]);
          const out = [(a[0] + b[0]) / 2 - middle[0], (a[1] + b[1]) / 2 - middle[1], (a[2] + b[2]) / 2 - middle[2]];
          if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
          const fi = i * 4 + f;
          faceN.set(n, fi * 3);
          for (let k = 0; k < 3; k++) faceMid[fi * 3 + k] = (pt(i, 3, la, k) + pt(i, 3, lb, k)) / 2;
          faceTone[fi] = AF_LEVELS + level(n);
        }
        // The upper face, though channelled, reads as one broad surface:
        // both halves take the tone of their mean. Halves apart, every leaf
        // is a folded blade, light and dark, and the plant an agave.
        const o = i * 12;
        const up = unit([faceN[o] + faceN[o + 3], faceN[o + 1] + faceN[o + 4], faceN[o + 2] + faceN[o + 5]]);
        faceTone[i * 4] = faceTone[i * 4 + 1] = level(up);
      }

      const dead = new Float32Array(AF_MODEL.dead.length);
      for (let o = 0; o < dead.length; o += 6) {
        turn(AF_MODEL.dead, dead, o, true);
        turn(AF_MODEL.dead, dead, o + 3, false);
      }
      const deadMid = new Float32Array(AF_DEAD * 3);
      const deadN = new Float32Array(AF_DEAD * 3);
      const deadTone = new Uint8Array(AF_DEAD * 2);
      for (let i = 0; i < AF_DEAD; i++) {
        const a = (i * AF_DEAD_PTS + 1) * 6;
        const b = (i * AF_DEAD_PTS + 3) * 6;
        const m = (i * AF_DEAD_PTS + 2) * 6;
        deadMid.set([dead[m], dead[m + 1], dead[m + 2]], i * 3);
        const t: V3 = [dead[b] - dead[a], dead[b + 1] - dead[a + 1], dead[b + 2] - dead[a + 2]];
        const w: V3 = [dead[m + 3], dead[m + 4], dead[m + 5]];
        let n = unit([w[1] * t[2] - w[2] * t[1], w[2] * t[0] - w[0] * t[2], w[0] * t[1] - w[1] * t[0]]);
        if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
        deadN.set(n, i * 3);
        deadTone[i * 2] = 2 * AF_LEVELS + level(n);
        deadTone[i * 2 + 1] = 2 * AF_LEVELS + level([-n[0], -n[1], -n[2]]);
      }
      const c = AF_MODEL.core;
      return { leaf, faceN, faceMid, faceTone, teeth, dead, deadMid, deadN, deadTone, core: [x + c[0] * h, c[1] * h, z + c[2] * h] };
    }

    /** Aloe ferox, after the app's model.
     *
     *  A big open rosette with no trunk yet: twenty-two thick, glaucous leaves,
     *  broad at the base and tapering to a point, the outer ones held out
     *  nearly flat, the middle ones longest and rising, the youngest standing
     *  up in the centre; red-brown teeth down every margin, and a skirt of
     *  dead brown leaves at the foot.
     *
     *  Each leaf is a solid, not a strap: a channelled upper face over a
     *  keeled underside, four faces each in its own tone, so from above it
     *  is a trough and from the side it has thickness. Every face toward
     *  the eye goes through one far-to-near sort with the dead leaves and the
     *  dark heart; then its margin, as a fine red-brown line, and close up
     *  its teeth. Grown once and cached; drawn through the local map at the
     *  heart, which a plant this size doesn't bend.
     */
    function drawFeroxBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = feroxGrown.get(key);
      if (!grown) {
        if (feroxGrown.size > 400) feroxGrown.clear(); // growth and edits mint new keys
        grown = growFerox(x, z, h, rot);
        feroxGrown.set(key, grown);
      }
      const { leaf, faceN, faceMid, faceTone, teeth, dead, deadMid, deadN, deadTone, core } = grown;
      const pal = sel ? FEROX_GOLD : FEROX_COLOURS;
      const tones = AF_TONES[sel ? 1 : 0];

      // The local map at the heart: screen x, y and depth per foot.
      const q = P(core[0], core[1], core[2]);
      const qx = P(core[0] + 1, core[1], core[2]);
      const qy = P(core[0], core[1] + 1, core[2]);
      const qz = P(core[0], core[1], core[2] + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const footPx = Math.hypot(J[1], J[4]);
      const sxOf = (o: Float32Array, i: number) =>
        q[0] + J[0] * (o[i] - core[0]) + J[1] * (o[i + 1] - core[1]) + J[2] * (o[i + 2] - core[2]);
      const syOf = (o: Float32Array, i: number) =>
        q[1] + J[3] * (o[i] - core[0]) + J[4] * (o[i + 1] - core[1]) + J[5] * (o[i + 2] - core[2]);
      const depthOf = (o: Float32Array, i: number) =>
        q[2] + J[6] * (o[i] - core[0]) + J[7] * (o[i + 1] - core[1]) + J[8] * (o[i + 2] - core[2]);

      // Faces toward the eye, the dead leaves and the heart, far to near.
      afOrder.length = 0;
      for (let f = 0; f < AF_FACES; f++) {
        const o = f * 3;
        const vis =
          faceN[o] * (eye[0] - faceMid[o]) + faceN[o + 1] * (eye[1] - faceMid[o + 1]) + faceN[o + 2] * (eye[2] - faceMid[o + 2]) > 0;
        afVis[f] = vis ? 1 : 0;
        afDone[f] = 0;
        if (!vis) continue;
        afDepth[f] = depthOf(faceMid, o);
        afOrder.push(f);
      }
      for (let i = 0; i < AF_DEAD; i++) {
        afDepth[AF_FACES + i] = depthOf(deadMid, i * 3);
        afOrder.push(AF_FACES + i);
      }
      afDepth[AF_FACES + AF_DEAD] = q[2];
      afOrder.push(AF_FACES + AF_DEAD);
      afOrder.sort((a, b) => afDepth[b] - afDepth[a]);

      const margins = footPx * h > 110;
      const toothed = footPx * h > 160;
      const marginW = Math.max(footPx * h * 0.0028, 0.6);
      for (const it of afOrder) {
        if (it < AF_FACES) {
          const i = it >> 2;
          const f = it & 3;
          const [la, lb] = AF_FACE_LINES[f];
          const base = i * AF_PTS * 12;
          ctx!.beginPath();
          for (let j = 0; j < AF_PTS; j++) {
            const o = base + j * 12 + la * 3;
            if (j === 0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
            else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          for (let j = AF_PTS - 1; j >= 0; j--) {
            const o = base + j * 12 + lb * 3;
            ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          ctx!.closePath();
          ctx!.fillStyle = tones[faceTone[it]];
          ctx!.fill();
          afDone[it] = 1;
          // The margin this face shares with its partner above or below,
          // drawn once, with whichever of the two comes last.
          const partner = it ^ 2;
          if (!margins || (afVis[partner] && !afDone[partner])) continue;
          const line = f === 0 || f === 2 ? 1 : 2;
          ctx!.beginPath();
          for (let j = 0; j < AF_PTS; j++) {
            const o = base + j * 12 + line * 3;
            if (j === 0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
            else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          ctx!.strokeStyle = pal.margin;
          ctx!.lineWidth = marginW;
          ctx!.stroke();
          if (toothed) {
            ctx!.beginPath();
            for (let k = 0; k < AF_TEETH; k++) {
              const o = ((i * 2 + line - 1) * AF_TEETH + k) * 9;
              const mx = sxOf(teeth, o);
              const my = syOf(teeth, o);
              const ox = J[0] * teeth[o + 3] + J[1] * teeth[o + 4] + J[2] * teeth[o + 5];
              const oy = J[3] * teeth[o + 3] + J[4] * teeth[o + 4] + J[5] * teeth[o + 5];
              const ax = J[0] * teeth[o + 6] + J[1] * teeth[o + 7] + J[2] * teeth[o + 8];
              const ay = J[3] * teeth[o + 6] + J[4] * teeth[o + 7] + J[5] * teeth[o + 8];
              ctx!.moveTo(mx - ax, my - ay);
              ctx!.lineTo(mx + ax, my + ay);
              ctx!.lineTo(mx + ox + ax * 0.6, my + oy + ay * 0.6);
              ctx!.closePath();
            }
            ctx!.fillStyle = pal.teeth;
            ctx!.fill();
          }
        } else if (it < AF_FACES + AF_DEAD) {
          const i = it - AF_FACES;
          const base = i * AF_DEAD_PTS * 6;
          const up =
            deadN[i * 3] * (eye[0] - deadMid[i * 3]) +
              deadN[i * 3 + 1] * (eye[1] - deadMid[i * 3 + 1]) +
              deadN[i * 3 + 2] * (eye[2] - deadMid[i * 3 + 2]) >
            0;
          ctx!.beginPath();
          for (let j = 0; j < AF_DEAD_PTS; j++) {
            const o = base + j * 6;
            const wx = J[0] * dead[o + 3] + J[1] * dead[o + 4] + J[2] * dead[o + 5];
            const wy = J[3] * dead[o + 3] + J[4] * dead[o + 4] + J[5] * dead[o + 5];
            if (j === 0) ctx!.moveTo(sxOf(dead, o) + wx, syOf(dead, o) + wy);
            else ctx!.lineTo(sxOf(dead, o) + wx, syOf(dead, o) + wy);
          }
          for (let j = AF_DEAD_PTS - 1; j >= 0; j--) {
            const o = base + j * 6;
            const wx = J[0] * dead[o + 3] + J[1] * dead[o + 4] + J[2] * dead[o + 5];
            const wy = J[3] * dead[o + 3] + J[4] * dead[o + 4] + J[5] * dead[o + 5];
            ctx!.lineTo(sxOf(dead, o) - wx, syOf(dead, o) - wy);
          }
          ctx!.closePath();
          ctx!.fillStyle = tones[deadTone[i * 2 + (up ? 0 : 1)]];
          ctx!.fill();
        } else {
          // The heart, where the leaf bases crowd: dark, so the gaps between
          // them read as depth rather than sand.
          const r = 0.13 * h;
          ctx!.beginPath();
          ctx!.ellipse(q[0], q[1], Math.hypot(J[0], J[2]) * r, Math.hypot(J[4] * 0.8, J[5]) * r, 0, 0, Math.PI * 2);
          ctx!.fillStyle = pal.core;
          ctx!.fill();
        }
      }
      ctx!.lineWidth = lw;
    }

    // The tropical agave's leaves, the same on every plant as in the
    // headset, in the model's measure (its height = 1): forty-eight straight
    // out of the ground on the golden angle. The oldest are splayed flat
    // across it; then a few held low; most rise at 45–65° in an open vase,
    // the youngest stand up in the middle. Every leaf arches back toward its
    // tip. A leaf is a strap, widest past its middle, soft and a little
    // twisted, so each is its centre line and the half-width across it,
    // station by station, as (x, y, z) pairs.
    const TA_LEAVES = 48;
    const TA_ALONG = [0, 0.12, 0.28, 0.46, 0.64, 0.82, 1];
    const TA_WIDE = [0.55, 0.85, 1, 1, 0.9, 0.6, 0];
    const TA_PTS = TA_ALONG.length;
    const TA_STRIPE = 0.6; // the green stripe, of the leaf's width
    const TA_LEVELS = 8;
    const taRamp = (lo: number[], hi: number[]) =>
      Array.from({ length: TA_LEVELS }, (_, i) => {
        const t = i / (TA_LEVELS - 1);
        return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
      });
    // Cream, green stripe, under — the sheet's and gold.
    const TA_TONES = [TROPICAL_AGAVE_COLOURS, TROPICAL_AGAVE_GOLD].map((pal) => [
      ...taRamp(pal.cream[0], pal.cream[1]),
      ...taRamp(pal.green[0], pal.green[1]),
      ...taRamp(pal.under[0], pal.under[1]),
    ]);
    // The scan's leaves by how steeply they leave the ground, oldest first:
    // where along the list (0–1) each elevation is reached, in degrees.
    const TA_RISE = [
      [0, -12],
      [0.22, 5],
      [0.4, 18],
      [0.55, 40],
      [0.6, 48],
      [0.88, 62],
      [1, 82],
    ];
    const TA_LEAF = (() => {
      const rng = rngFor("tropical-agave");
      const deg = Math.PI / 180;
      const out = new Float32Array(TA_LEAVES * TA_PTS * 6);
      let top = 0;
      for (let i = 0; i < TA_LEAVES; i++) {
        const t = i / (TA_LEAVES - 1);
        let k = 0;
        while (k < TA_RISE.length - 2 && TA_RISE[k + 1][0] < t) k++;
        const f = (t - TA_RISE[k][0]) / (TA_RISE[k + 1][0] - TA_RISE[k][0]);
        const chord = TA_RISE[k][1] + (TA_RISE[k + 1][1] - TA_RISE[k][1]) * f + (rng() - 0.5) * 8;
        // Arching back: the steeper the leaf, the more it bends over at the
        // end; the flat ones lie on the ground already.
        const bend = (chord < 10 ? 18 : 22 + 14 * Math.sin(Math.min(1, chord / 70) * Math.PI)) * (0.75 + 0.5 * rng()) * deg;
        const e0 = chord * deg + bend * 0.45;
        const len = (0.47 + 0.0062 * Math.max(0, chord)) * (0.9 + 0.2 * rng()) * 1.04;
        const hw = 0.12 * (0.85 + 0.3 * rng()) * (1 - 0.2 * t);
        const az = i * 2.39996 + (rng() - 0.5) * 0.3;
        const tw0 = (rng() - 0.5) * 0.5;
        const tw1 = (rng() - 0.5) * 0.9;
        const dx = Math.cos(az);
        const dz = Math.sin(az);
        let px = dx * 0.04 * (1 - t);
        let py = 0.02 + 0.08 * t;
        let pz = dz * 0.04 * (1 - t);
        let prev = 0;
        for (let j = 0; j < TA_PTS; j++) {
          const s = TA_ALONG[j];
          if (j > 0) {
            const sm = (prev + s) / 2;
            const e = e0 - bend * Math.pow(sm, 1.6);
            const step = (s - prev) * len;
            px += dx * Math.cos(e) * step;
            py = Math.max(0.006, py + Math.sin(e) * step);
            pz += dz * Math.cos(e) * step;
          }
          prev = s;
          // Across the leaf, twisted a little along it about its own line.
          const e = e0 - bend * Math.pow(s, 1.6);
          const tw = tw0 + tw1 * s;
          const w = hw * TA_WIDE[j];
          const o = (i * TA_PTS + j) * 6;
          out[o] = px;
          out[o + 1] = py;
          out[o + 2] = pz;
          out[o + 3] = (-dz * Math.cos(tw) - dx * Math.sin(e) * Math.sin(tw)) * w;
          out[o + 4] = Math.cos(e) * Math.sin(tw) * w;
          out[o + 5] = (dx * Math.cos(tw) - dz * Math.sin(e) * Math.sin(tw)) * w;
          top = Math.max(top, py);
        }
      }
      for (let k = 1; k < out.length; k += 3) out[k] /= top;
      return out;
    })();

    // Grown once per plant and kept, as the trees are.
    type TropicalAgavePlant = {
      /** each leaf's centre line and half-width, turned, scaled and placed;
       *  its middle; the normal of its upper face; and its tones — margin
       *  and stripe seen from above, then from below */
      leaf: Float32Array;
      mid: Float32Array;
      leafN: Float32Array;
      leafTone: Uint8Array;
      heart: [number, number, number];
    };
    const tropicalAgaveGrown = new Map<string, TropicalAgavePlant>();
    // Scratch, reused plant to plant.
    const taOrder: number[] = [];
    const taDepth = new Float32Array(TA_LEAVES);

    function growTropicalAgave(x: number, z: number, h: number, rot: number): TropicalAgavePlant {
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const level = (n: V3) =>
        Math.max(0, Math.min(TA_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (TA_LEVELS - 1))));
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const leaf = new Float32Array(TA_LEAF.length);
      for (let o = 0; o < leaf.length; o += 6) {
        const mx = TA_LEAF[o];
        const mz = TA_LEAF[o + 2];
        const wx = TA_LEAF[o + 3];
        const wz = TA_LEAF[o + 5];
        leaf[o] = x + (mx * cr - mz * sr) * h;
        leaf[o + 1] = TA_LEAF[o + 1] * h;
        leaf[o + 2] = z + (mx * sr + mz * cr) * h;
        leaf[o + 3] = (wx * cr - wz * sr) * h;
        leaf[o + 4] = TA_LEAF[o + 4] * h;
        leaf[o + 5] = (wx * sr + wz * cr) * h;
      }
      const mid = new Float32Array(TA_LEAVES * 3);
      const leafN = new Float32Array(TA_LEAVES * 3);
      const leafTone = new Uint8Array(TA_LEAVES * 4);
      for (let i = 0; i < TA_LEAVES; i++) {
        const a = (i * TA_PTS + 2) * 6;
        const b = (i * TA_PTS + 4) * 6;
        const m = (i * TA_PTS + 3) * 6;
        mid.set([leaf[m], leaf[m + 1], leaf[m + 2]], i * 3);
        // Up off the leaf: across it, crossed with along it.
        const tx = leaf[b] - leaf[a];
        const ty = leaf[b + 1] - leaf[a + 1];
        const tz = leaf[b + 2] - leaf[a + 2];
        const wx = leaf[m + 3];
        const wy = leaf[m + 4];
        const wz = leaf[m + 5];
        let n: V3 = [wy * tz - wz * ty, wz * tx - wx * tz, wx * ty - wy * tx];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        n = [n[0] / nl, n[1] / nl, n[2] / nl];
        leafN.set(n, i * 3);
        const down = level([-n[0], -n[1], -n[2]]);
        leafTone[i * 4] = level(n);
        leafTone[i * 4 + 1] = TA_LEVELS + level(n);
        leafTone[i * 4 + 2] = 2 * TA_LEVELS + down;
        leafTone[i * 4 + 3] = TA_LEVELS + down;
      }
      return { leaf, mid, leafN, leafTone, heart: [x, 0.3 * h, z] };
    }

    /** Tropical agave, after the app's model.
     *
     *  A variegated agave in an open vase: forty-eight soft strap leaves
     *  out of the ground, the oldest splayed flat across it, most rising
     *  steeply and arching back at their tips, the youngest upright in the
     *  middle. Cream margins down every leaf with a green stripe between,
     *  paler green beneath.
     *
     *  Each leaf is a twisted ribbon, cream with a green stripe down it, toned
     *  by whichever face shows — drawn far to near, and
     *  close up its small dark tip spine. Grown once and cached; drawn
     *  through the local map at the heart, which a plant this size doesn't
     *  bend.
     */
    function drawTropicalAgaveBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = tropicalAgaveGrown.get(key);
      if (!grown) {
        if (tropicalAgaveGrown.size > 400) tropicalAgaveGrown.clear(); // growth and edits mint new keys
        grown = growTropicalAgave(x, z, h, rot);
        tropicalAgaveGrown.set(key, grown);
      }
      const { leaf, mid, leafN, leafTone, heart } = grown;
      const pal = sel ? TROPICAL_AGAVE_GOLD : TROPICAL_AGAVE_COLOURS;
      const tones = TA_TONES[sel ? 1 : 0];

      // The local map at the heart: screen x, y and depth per foot.
      const q = P(heart[0], heart[1], heart[2]);
      const qx = P(heart[0] + 1, heart[1], heart[2]);
      const qy = P(heart[0], heart[1] + 1, heart[2]);
      const qz = P(heart[0], heart[1], heart[2] + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const footPx = Math.hypot(J[1], J[4]);
      const sxOf = (o: number) => q[0] + J[0] * (leaf[o] - heart[0]) + J[1] * (leaf[o + 1] - heart[1]) + J[2] * (leaf[o + 2] - heart[2]);
      const syOf = (o: number) => q[1] + J[3] * (leaf[o] - heart[0]) + J[4] * (leaf[o + 1] - heart[1]) + J[5] * (leaf[o + 2] - heart[2]);

      taOrder.length = 0;
      for (let i = 0; i < TA_LEAVES; i++) {
        taDepth[i] = q[2] + J[6] * (mid[i * 3] - heart[0]) + J[7] * (mid[i * 3 + 1] - heart[1]) + J[8] * (mid[i * 3 + 2] - heart[2]);
        taOrder.push(i);
      }
      taOrder.sort((a, b) => taDepth[b] - taDepth[a]);

      // A ribbon along the leaf, its half-width scaled by `wide`.
      const ribbon = (o0: number, wide: number) => {
        ctx!.beginPath();
        for (let j = 0; j < TA_PTS; j++) {
          const o = o0 + j * 6;
          const wx = (J[0] * leaf[o + 3] + J[1] * leaf[o + 4] + J[2] * leaf[o + 5]) * wide;
          const wy = (J[3] * leaf[o + 3] + J[4] * leaf[o + 4] + J[5] * leaf[o + 5]) * wide;
          if (j === 0) ctx!.moveTo(sxOf(o) + wx, syOf(o) + wy);
          else ctx!.lineTo(sxOf(o) + wx, syOf(o) + wy);
        }
        for (let j = TA_PTS - 1; j >= 0; j--) {
          const o = o0 + j * 6;
          const wx = (J[0] * leaf[o + 3] + J[1] * leaf[o + 4] + J[2] * leaf[o + 5]) * wide;
          const wy = (J[3] * leaf[o + 3] + J[4] * leaf[o + 4] + J[5] * leaf[o + 5]) * wide;
          ctx!.lineTo(sxOf(o) - wx, syOf(o) - wy);
        }
        ctx!.closePath();
      };
      const spines = footPx * h > 250;
      for (const i of taOrder) {
        const o0 = i * TA_PTS * 6;
        const up =
          leafN[i * 3] * (eye[0] - mid[i * 3]) + leafN[i * 3 + 1] * (eye[1] - mid[i * 3 + 1]) + leafN[i * 3 + 2] * (eye[2] - mid[i * 3 + 2]) > 0;
        // The variegation shows on both faces: without it beneath, the
        // upright leaves' backs merge into one flat blob.
        const side = i * 4 + (up ? 0 : 2);
        ribbon(o0, 1);
        ctx!.fillStyle = tones[leafTone[side]];
        ctx!.fill();
        ribbon(o0, TA_STRIPE);
        ctx!.fillStyle = tones[leafTone[side + 1]];
        ctx!.fill();
        if (spines) {
          // On past the tip, along the leaf's last stretch.
          const a = o0 + (TA_PTS - 2) * 6;
          const b = o0 + (TA_PTS - 1) * 6;
          const ex = sxOf(b);
          const ey = syOf(b);
          const ux = ex - sxOf(a);
          const uy = ey - syOf(a);
          ctx!.beginPath();
          ctx!.moveTo(ex - ux * 0.15, ey - uy * 0.15);
          ctx!.lineTo(ex + ux * 0.1, ey + uy * 0.1);
          ctx!.strokeStyle = pal.spine;
          ctx!.lineWidth = Math.max(footPx * h * 0.004, 0.8);
          ctx!.lineCap = "round";
          ctx!.stroke();
          ctx!.lineCap = "butt";
        }
      }
      ctx!.lineWidth = lw;
    }

    // The americana's leaves, the same on every plant as in the headset, in
    // the model's measure (its height = 1): twenty-four on the golden angle off a
    // short stem, rising steeply — the outer ones at 30–40°, most at 50–70°,
    // the youngest nearly upright — each bending back a little toward its
    // tip, and some of the old outer ones buckled partway out, as americana's
    // leaves do. A leaf is a thick folded blade: the fold down its middle,
    // the two margins raised high above it into a V, the keel beneath; four
    // faces between those lines. Each station holds fold, left margin, right
    // margin, keel, as (x, y, z).
    const AM_LEAVES = 24;
    const AM_ALONG = [0, 0.12, 0.28, 0.46, 0.64, 0.82, 1];
    const AM_WIDE = [0.9, 1, 0.95, 0.8, 0.6, 0.34, 0];
    const AM_PTS = AM_ALONG.length;
    const AM_FACES = AM_LEAVES * 4;
    const AM_FACE_LINES = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ];
    const AM_TEETH = 10; // down each margin
    const AM_DEAD = 2;
    const AM_DEAD_PTS = 5;
    const AM_LEVELS = 8;
    // The scan's leaves by elevation, oldest first: where along the list
    // (0–1) each is reached, in degrees.
    const AM_RISE = [
      [0, 28],
      [0.2, 40],
      [0.5, 54],
      [0.8, 68],
      [1, 84],
    ];
    const amRamp = (lo: number[], hi: number[]) =>
      Array.from({ length: AM_LEVELS }, (_, i) => {
        const t = i / (AM_LEVELS - 1);
        return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
      });
    // Upper, under, dusty upper, dusty under, dead — the sheet's and gold.
    const AM_TONES = [AMERICANA_COLOURS, AMERICANA_GOLD].map((pal) => [
      ...amRamp(pal.upper[0], pal.upper[1]),
      ...amRamp(pal.under[0], pal.under[1]),
      ...amRamp(pal.dustyUpper[0], pal.dustyUpper[1]),
      ...amRamp(pal.dustyUnder[0], pal.dustyUnder[1]),
      ...amRamp(pal.dead[0], pal.dead[1]),
    ]);
    const AM_MODEL = (() => {
      const rng = rngFor("agave-americana");
      const deg = Math.PI / 180;
      const leaf = new Float32Array(AM_LEAVES * AM_PTS * 12);
      // Each tooth: where it sits on the margin, then out to its point, then
      // half its foot along the margin.
      const teeth = new Float32Array(AM_LEAVES * 2 * AM_TEETH * 9);
      // Each leaf's tip, and the end of the spine past it.
      const spine = new Float32Array(AM_LEAVES * 6);
      const dusty = new Uint8Array(AM_LEAVES);
      const dead = new Float32Array(AM_DEAD * AM_DEAD_PTS * 6);
      let top = 0;
      for (let i = 0; i < AM_LEAVES; i++) {
        const t = i / (AM_LEAVES - 1); // 0 the oldest, outermost; 1 the youngest
        let k = 0;
        while (k < AM_RISE.length - 2 && AM_RISE[k + 1][0] < t) k++;
        const f = (t - AM_RISE[k][0]) / (AM_RISE[k + 1][0] - AM_RISE[k][0]);
        const chord = AM_RISE[k][1] + (AM_RISE[k + 1][1] - AM_RISE[k][1]) * f + (rng() - 0.5) * 8;
        const bend = (8 + 10 * (1 - t) + (rng() - 0.5) * 10) * deg;
        const e0 = chord * deg + bend * 0.4;
        // A few old leaves buckle partway out and hang their outer half.
        const kink = t < 0.4 && rng() < 0.3 ? (25 + rng() * 15) * deg : 0;
        const len = (0.72 + 0.003 * chord) * (0.92 + 0.16 * rng());
        const hw = 0.15 * (0.85 + 0.3 * rng()) * (1 - 0.2 * t);
        const az = i * 2.39996 + (rng() - 0.5) * 0.3;
        const sway = (rng() - 0.5) * 24 * deg;
        dusty[i] = t < 0.3 ? 1 : 0;
        const angle = (s: number) =>
          e0 - bend * Math.pow(s, 1.5) - kink * Math.max(0, Math.min(1, (s - 0.5) / 0.12));
        const r0 = 0.05 * (1 - 0.6 * t);
        let px = Math.cos(az) * r0;
        let py = 0.03 + 0.1 * t;
        let pz = Math.sin(az) * r0;
        let prev = 0;
        const frame: number[][] = [];
        for (let j = 0; j < AM_PTS; j++) {
          const s = AM_ALONG[j];
          if (j > 0) {
            const sm = (prev + s) / 2;
            const e = angle(sm);
            const ps = az + sway * sm * sm;
            const step = (s - prev) * len;
            px += Math.cos(e) * Math.cos(ps) * step;
            py = Math.max(0.006, py + Math.sin(e) * step);
            pz += Math.cos(e) * Math.sin(ps) * step;
          }
          prev = s;
          // Along the leaf; across it, level; up off its upper face.
          const e = angle(s);
          const ps = az + sway * s * s;
          const T = [Math.cos(e) * Math.cos(ps), Math.sin(e), Math.cos(e) * Math.sin(ps)];
          const S = [-Math.sin(ps), 0, Math.cos(ps)];
          const N = [-Math.cos(ps) * Math.sin(e), Math.cos(e), -Math.sin(ps) * Math.sin(e)];
          const w = hw * AM_WIDE[j];
          const fold = 0.3 * w;
          const keel = 0.32 * w;
          leaf.set(
            [
              px, py, pz,
              px + S[0] * w + N[0] * fold, py + N[1] * fold, pz + S[2] * w + N[2] * fold,
              px - S[0] * w + N[0] * fold, py + N[1] * fold, pz - S[2] * w + N[2] * fold,
              px - N[0] * keel, py - N[1] * keel, pz - N[2] * keel,
            ],
            (i * AM_PTS + j) * 12,
          );
          frame.push([...T, ...S, ...N]);
          top = Math.max(top, py);
        }
        // The terminal spine: long and dark, on along the last stretch.
        const T = frame[AM_PTS - 1];
        const tip = (i * AM_PTS + AM_PTS - 1) * 12;
        const sl = 0.055 * len;
        spine.set([leaf[tip], leaf[tip + 1], leaf[tip + 2], leaf[tip] + T[0] * sl, leaf[tip + 1] + T[1] * sl, leaf[tip + 2] + T[2] * sl], i * 6);
        // Big teeth down both margins, hooked toward the tip, smaller as the
        // leaf narrows.
        for (let side = 0; side < 2; side++) {
          const sg = side === 0 ? 1 : -1;
          for (let k2 = 0; k2 < AM_TEETH; k2++) {
            const s = 0.06 + (0.76 * (k2 + 0.3 + rng() * 0.4)) / AM_TEETH;
            let j = 0;
            while (j < AM_PTS - 2 && AM_ALONG[j + 1] < s) j++;
            const fr = (s - AM_ALONG[j]) / (AM_ALONG[j + 1] - AM_ALONG[j]);
            const a = (i * AM_PTS + j) * 12 + 3 + side * 3;
            const b = a + 12;
            const [Tx, Ty, Tz, Sx, , Sz, Nx, Ny, Nz] = frame[j];
            const size = (hw / 0.15) * (1 - 0.5 * s);
            const out = 0.018 * size;
            const foot = 0.009 * size;
            teeth.set(
              [
                leaf[a] + (leaf[b] - leaf[a]) * fr,
                leaf[a + 1] + (leaf[b + 1] - leaf[a + 1]) * fr,
                leaf[a + 2] + (leaf[b + 2] - leaf[a + 2]) * fr,
                (Sx * sg * 0.85 + Nx * 0.25 + Tx * 0.45) * out,
                (Ny * 0.25 + Ty * 0.45) * out,
                (Sz * sg * 0.85 + Nz * 0.25 + Tz * 0.45) * out,
                Tx * foot,
                Ty * foot,
                Tz * foot,
              ],
              ((i * 2 + side) * AM_TEETH + k2) * 9,
            );
          }
        }
      }
      // The dead leaves: brown, lying flat out across the ground.
      for (let i = 0; i < AM_DEAD; i++) {
        const az = i * 2.39996 + 0.5 + (rng() - 0.5) * 0.6;
        const len = 0.22 + rng() * 0.08;
        const hw = 0.035 * (0.8 + 0.4 * rng());
        const lift = (rng() - 0.5) * 0.8;
        for (let j = 0; j < AM_DEAD_PTS; j++) {
          const s = j / (AM_DEAD_PTS - 1);
          const r = 0.04 + s * len;
          const w = hw * (1 - 0.8 * s);
          const a = az + (rng() - 0.5) * 0.08;
          dead.set(
            [Math.cos(a) * r, 0.006 + 0.03 * (1 - s), Math.sin(a) * r, -Math.sin(a) * w, lift * w, Math.cos(a) * w],
            (i * AM_DEAD_PTS + j) * 6,
          );
        }
      }
      // The tallest leaf tip to the full height.
      const ys = 1 / top;
      for (let k = 1; k < leaf.length; k += 3) leaf[k] *= ys;
      for (let k = 1; k < teeth.length; k += 3) teeth[k] *= ys;
      for (let k = 1; k < spine.length; k += 3) spine[k] *= ys;
      for (let k = 1; k < dead.length; k += 3) dead[k] *= ys;
      return { leaf, teeth, spine, dusty, dead, core: [0, 0.12 * ys, 0] };
    })();

    // Grown once per plant and kept, as the trees are.
    type AmericanaPlant = {
      /** the leaves' lines, turned, scaled and placed */
      leaf: Float32Array;
      /** each face's outward normal, its middle and its tone */
      faceN: Float32Array;
      faceMid: Float32Array;
      faceTone: Uint8Array;
      teeth: Float32Array;
      spine: Float32Array;
      /** the dead leaves as centre and half-width, and their tones seen from
       *  above and below */
      dead: Float32Array;
      deadMid: Float32Array;
      deadTone: Uint8Array;
      core: [number, number, number];
    };
    const americanaGrown = new Map<string, AmericanaPlant>();
    // Scratch, reused plant to plant.
    const amOrder: number[] = [];
    const amDepth = new Float32Array(AM_FACES + AM_DEAD + 1);
    const amVis = new Uint8Array(AM_FACES);
    const amDone = new Uint8Array(AM_FACES);

    function growAmericana(x: number, z: number, h: number, rot: number): AmericanaPlant {
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const level = (n: V3) =>
        Math.max(0, Math.min(AM_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (AM_LEVELS - 1))));
      const unit = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const turn = (src: Float32Array, dst: Float32Array, o: number, offset: boolean) => {
        const mx = src[o];
        const mz = src[o + 2];
        dst[o] = (offset ? x : 0) + (mx * cr - mz * sr) * h;
        dst[o + 1] = src[o + 1] * h;
        dst[o + 2] = (offset ? z : 0) + (mx * sr + mz * cr) * h;
      };

      const leaf = new Float32Array(AM_MODEL.leaf.length);
      for (let o = 0; o < leaf.length; o += 3) turn(AM_MODEL.leaf, leaf, o, true);
      const teeth = new Float32Array(AM_MODEL.teeth.length);
      for (let o = 0; o < teeth.length; o += 9) {
        turn(AM_MODEL.teeth, teeth, o, true);
        turn(AM_MODEL.teeth, teeth, o + 3, false);
        turn(AM_MODEL.teeth, teeth, o + 6, false);
      }
      const spine = new Float32Array(AM_MODEL.spine.length);
      for (let o = 0; o < spine.length; o += 3) turn(AM_MODEL.spine, spine, o, true);
      // Each face lit by its normal a third of the way out, pointed away
      // from the middle of the leaf's section. The two halves of the upper
      // face are shaded apart: the fold, light on one side and dark on the
      // other, is what makes an agave leaf an agave's.
      const faceN = new Float32Array(AM_FACES * 3);
      const faceMid = new Float32Array(AM_FACES * 3);
      const faceTone = new Uint8Array(AM_FACES);
      const pt = (i: number, j: number, line: number, k: number) => leaf[(i * AM_PTS + j) * 12 + line * 3 + k];
      for (let i = 0; i < AM_LEAVES; i++) {
        const along: V3 = [0, 1, 2].map((k) => pt(i, 3, 0, k) - pt(i, 1, 0, k)) as V3;
        const middle: V3 = [0, 1, 2].map((k) => pt(i, 2, 0, k) * 0.6 + pt(i, 2, 3, k) * 0.4) as V3;
        const base = AM_MODEL.dusty[i] ? 2 * AM_LEVELS : 0;
        for (let f = 0; f < 4; f++) {
          const [la, lb] = AM_FACE_LINES[f];
          const a: V3 = [0, 1, 2].map((k) => pt(i, 2, la, k)) as V3;
          const b: V3 = [0, 1, 2].map((k) => pt(i, 2, lb, k)) as V3;
          const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          let n = unit([along[1] * ac[2] - along[2] * ac[1], along[2] * ac[0] - along[0] * ac[2], along[0] * ac[1] - along[1] * ac[0]]);
          const out = [(a[0] + b[0]) / 2 - middle[0], (a[1] + b[1]) / 2 - middle[1], (a[2] + b[2]) / 2 - middle[2]];
          if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
          const fi = i * 4 + f;
          faceN.set(n, fi * 3);
          for (let k = 0; k < 3; k++) faceMid[fi * 3 + k] = (pt(i, 3, la, k) + pt(i, 3, lb, k)) / 2;
          faceTone[fi] = base + (f < 2 ? 0 : AM_LEVELS) + level(n);
        }
      }

      const dead = new Float32Array(AM_MODEL.dead.length);
      for (let o = 0; o < dead.length; o += 6) {
        turn(AM_MODEL.dead, dead, o, true);
        turn(AM_MODEL.dead, dead, o + 3, false);
      }
      const deadMid = new Float32Array(AM_DEAD * 3);
      const deadTone = new Uint8Array(AM_DEAD * 2);
      for (let i = 0; i < AM_DEAD; i++) {
        const m = (i * AM_DEAD_PTS + 2) * 6;
        deadMid.set([dead[m], dead[m + 1], dead[m + 2]], i * 3);
        // Lying nearly flat: lit from above, shaded beneath.
        deadTone[i * 2] = 4 * AM_LEVELS + level(unit([dead[m + 3] * 0.3, 1, dead[m + 5] * 0.3]));
        deadTone[i * 2 + 1] = 4 * AM_LEVELS + 1;
      }
      const c = AM_MODEL.core;
      return { leaf, faceN, faceMid, faceTone, teeth, spine, dead, deadMid, deadTone, core: [x + c[0] * h, c[1] * h, z + c[2] * h] };
    }

    /** Agave americana, after the app's model.
     *
     *  A big upright rosette: twenty-four broad, thick, glaucous blue-grey leaves,
     *  folded into a V and tapering to a long dark spine, rising steeply and
     *  bending back a little at their ends; some of the old outer ones
     *  buckled partway out, gone dusty tan; dead ones brown on the ground;
     *  big hooked teeth down every margin.
     *
     *  Each leaf is a solid of four faces — the two halves of the folded
     *  upper face, light and dark, over a keeled underside — every face
     *  toward the eye in one far-to-near sort with the dead leaves and the
     *  dark heart. Then its margin, its teeth and its spine, as soon as
     *  they'd show. Grown once and cached; drawn through the local map at
     *  the heart.
     */
    function drawAmericanaBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = americanaGrown.get(key);
      if (!grown) {
        if (americanaGrown.size > 400) americanaGrown.clear(); // growth and edits mint new keys
        grown = growAmericana(x, z, h, rot);
        americanaGrown.set(key, grown);
      }
      const { leaf, faceN, faceMid, faceTone, teeth, spine, dead, deadMid, deadTone, core } = grown;
      const pal = sel ? AMERICANA_GOLD : AMERICANA_COLOURS;
      const tones = AM_TONES[sel ? 1 : 0];

      // The local map at the heart: screen x, y and depth per foot.
      const q = P(core[0], core[1], core[2]);
      const qx = P(core[0] + 1, core[1], core[2]);
      const qy = P(core[0], core[1] + 1, core[2]);
      const qz = P(core[0], core[1], core[2] + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const footPx = Math.hypot(J[1], J[4]);
      const sxOf = (o: Float32Array, i: number) =>
        q[0] + J[0] * (o[i] - core[0]) + J[1] * (o[i + 1] - core[1]) + J[2] * (o[i + 2] - core[2]);
      const syOf = (o: Float32Array, i: number) =>
        q[1] + J[3] * (o[i] - core[0]) + J[4] * (o[i + 1] - core[1]) + J[5] * (o[i + 2] - core[2]);
      const depthOf = (o: Float32Array, i: number) =>
        q[2] + J[6] * (o[i] - core[0]) + J[7] * (o[i + 1] - core[1]) + J[8] * (o[i + 2] - core[2]);

      // Faces toward the eye, the dead leaves and the heart, far to near.
      amOrder.length = 0;
      for (let f = 0; f < AM_FACES; f++) {
        const o = f * 3;
        const vis =
          faceN[o] * (eye[0] - faceMid[o]) + faceN[o + 1] * (eye[1] - faceMid[o + 1]) + faceN[o + 2] * (eye[2] - faceMid[o + 2]) > 0;
        amVis[f] = vis ? 1 : 0;
        amDone[f] = 0;
        if (!vis) continue;
        amDepth[f] = depthOf(faceMid, o);
        amOrder.push(f);
      }
      for (let i = 0; i < AM_DEAD; i++) {
        amDepth[AM_FACES + i] = depthOf(deadMid, i * 3);
        amOrder.push(AM_FACES + i);
      }
      amDepth[AM_FACES + AM_DEAD] = q[2];
      amOrder.push(AM_FACES + AM_DEAD);
      amOrder.sort((a, b) => amDepth[b] - amDepth[a]);

      const margins = footPx * h > 70;
      const toothed = footPx * h > 140;
      const marginW = Math.max(footPx * h * 0.0024, 0.6);
      for (const it of amOrder) {
        if (it < AM_FACES) {
          const i = it >> 2;
          const f = it & 3;
          const [la, lb] = AM_FACE_LINES[f];
          const base = i * AM_PTS * 12;
          ctx!.beginPath();
          for (let j = 0; j < AM_PTS; j++) {
            const o = base + j * 12 + la * 3;
            if (j === 0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
            else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          for (let j = AM_PTS - 1; j >= 0; j--) {
            const o = base + j * 12 + lb * 3;
            ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          ctx!.closePath();
          ctx!.fillStyle = tones[faceTone[it]];
          ctx!.fill();
          amDone[it] = 1;
          // The margin this face shares with its partner above or below,
          // its teeth, and — once per leaf, with the last of its faces to
          // show — the spine.
          const partner = it ^ 2;
          if (!margins || (amVis[partner] && !amDone[partner])) continue;
          const line = f === 0 || f === 2 ? 1 : 2;
          ctx!.beginPath();
          for (let j = 0; j < AM_PTS; j++) {
            const o = base + j * 12 + line * 3;
            if (j === 0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
            else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          ctx!.strokeStyle = pal.margin;
          ctx!.lineWidth = marginW;
          ctx!.stroke();
          if (toothed) {
            ctx!.beginPath();
            for (let k = 0; k < AM_TEETH; k++) {
              const o = ((i * 2 + line - 1) * AM_TEETH + k) * 9;
              const mx = sxOf(teeth, o);
              const my = syOf(teeth, o);
              const ox = J[0] * teeth[o + 3] + J[1] * teeth[o + 4] + J[2] * teeth[o + 5];
              const oy = J[3] * teeth[o + 3] + J[4] * teeth[o + 4] + J[5] * teeth[o + 5];
              const ax = J[0] * teeth[o + 6] + J[1] * teeth[o + 7] + J[2] * teeth[o + 8];
              const ay = J[3] * teeth[o + 6] + J[4] * teeth[o + 7] + J[5] * teeth[o + 8];
              ctx!.moveTo(mx - ax, my - ay);
              ctx!.lineTo(mx + ax, my + ay);
              ctx!.lineTo(mx + ox + ax * 0.8, my + oy + ay * 0.8);
              ctx!.closePath();
            }
            ctx!.fillStyle = pal.teeth;
            ctx!.fill();
          }
          let last = true;
          for (let g = 0; g < 4; g++) if (amVis[i * 4 + g] && !amDone[i * 4 + g]) last = false;
          if (last) {
            ctx!.beginPath();
            ctx!.moveTo(sxOf(spine, i * 6), syOf(spine, i * 6));
            ctx!.lineTo(sxOf(spine, i * 6 + 3), syOf(spine, i * 6 + 3));
            ctx!.strokeStyle = pal.spine;
            ctx!.lineWidth = Math.max(footPx * h * 0.006, 0.8);
            ctx!.lineCap = "round";
            ctx!.stroke();
            ctx!.lineCap = "butt";
          }
        } else if (it < AM_FACES + AM_DEAD) {
          const i = it - AM_FACES;
          const base = i * AM_DEAD_PTS * 6;
          ctx!.beginPath();
          for (let j = 0; j < AM_DEAD_PTS; j++) {
            const o = base + j * 6;
            const wx = J[0] * dead[o + 3] + J[1] * dead[o + 4] + J[2] * dead[o + 5];
            const wy = J[3] * dead[o + 3] + J[4] * dead[o + 4] + J[5] * dead[o + 5];
            if (j === 0) ctx!.moveTo(sxOf(dead, o) + wx, syOf(dead, o) + wy);
            else ctx!.lineTo(sxOf(dead, o) + wx, syOf(dead, o) + wy);
          }
          for (let j = AM_DEAD_PTS - 1; j >= 0; j--) {
            const o = base + j * 6;
            const wx = J[0] * dead[o + 3] + J[1] * dead[o + 4] + J[2] * dead[o + 5];
            const wy = J[3] * dead[o + 3] + J[4] * dead[o + 4] + J[5] * dead[o + 5];
            ctx!.lineTo(sxOf(dead, o) - wx, syOf(dead, o) - wy);
          }
          ctx!.closePath();
          ctx!.fillStyle = tones[deadTone[i * 2 + (eye[1] > deadMid[i * 3 + 1] ? 0 : 1)]];
          ctx!.fill();
        } else {
          // The heart, where the leaf bases crowd: dark.
          const r = 0.09 * h;
          ctx!.beginPath();
          ctx!.ellipse(q[0], q[1], Math.hypot(J[0], J[2]) * r, Math.hypot(J[4] * 0.8, J[5]) * r, 0, 0, Math.PI * 2);
          ctx!.fillStyle = pal.core;
          ctx!.fill();
        }
      }
      ctx!.lineWidth = lw;
    }

    // The truncata's leaves, the same on every plant as in the headset, in
    // the model's measure (its height = 1): thirty-four on the golden angle
    // up a short cone, their tips spread evenly over a dome — the oldest out
    // at the rim a third of the way up, the youngest closed into a bud at
    // the top. Every leaf leaves the stem flatter than it ends: they curl
    // up and in, which is what stands the sides up straight and makes the
    // artichoke. A leaf is a broad, thick spoon: the fold down its middle,
    // the margins cupped up either side of it, a shallow keel beneath; four
    // faces between those lines, and every face in two halves — below and
    // above the leaf's widest — since a leaf that runs out flat and then
    // stands up shows its back only on the half that stands. Each station
    // holds fold, left margin, right margin, keel, as (x, y, z).
    const TC_LEAVES = 34;
    const TC_ALONG = [0, 0.14, 0.3, 0.46, 0.62, 0.76, 0.87, 0.94, 1];
    // Narrow where it joins, widest three-quarters out, then rounded off
    // short to the spine: a paddle, not a blade.
    const TC_WIDE = [0.4, 0.55, 0.72, 0.88, 0.98, 1, 0.86, 0.56, 0];
    const TC_PTS = TC_ALONG.length;
    const TC_SPLIT = 4; // the station the two halves share
    const TC_FACES = TC_LEAVES * 2 * 4;
    const TC_FACE_LINES = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ];
    const TC_TEETH = 8; // down each margin
    const TC_LEVELS = 8;
    const tcRamp = (lo: number[], hi: number[]) =>
      Array.from({ length: TC_LEVELS }, (_, i) => {
        const t = i / (TC_LEVELS - 1);
        return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
      });
    // Upper, then under — the sheet's and gold.
    const TC_TONES = [TRUNCATA_COLOURS, TRUNCATA_GOLD].map((pal) => [
      ...tcRamp(pal.upper[0], pal.upper[1]),
      ...tcRamp(pal.under[0], pal.under[1]),
    ]);
    const TC_MODEL = (() => {
      const rng = rngFor("agave-truncata");
      const deg = Math.PI / 180;
      const leaf = new Float32Array(TC_LEAVES * TC_PTS * 12);
      // Each tooth: where it sits on the margin, then out to its point, then
      // half its foot along the margin.
      const teeth = new Float32Array(TC_LEAVES * 2 * TC_TEETH * 9);
      const toothHalf = new Uint8Array(TC_LEAVES * 2 * TC_TEETH);
      // Each leaf's tip, and the end of the spine past it.
      const spine = new Float32Array(TC_LEAVES * 6);
      let top = 0;
      for (let i = 0; i < TC_LEAVES; i++) {
        const t = i / (TC_LEAVES - 1); // 0 the oldest, outermost; 1 the youngest
        // Where the tip lands on the dome, and where the leaf leaves the stem.
        const lat = (6 + 76 * t + (rng() - 0.5) * 6) * deg;
        const tipR = 1.02 * Math.cos(lat);
        const tipY = 0.28 + 0.72 * Math.sin(lat);
        // A broad crown: the old leaves come out of it well clear of the
        // middle, so what shows of them stands up as a wall.
        const r0 = 0.03 + 0.5 * Math.pow(1 - t, 1.5);
        const y0 = 0.03 + 0.4 * Math.pow(t, 1.2);
        // The curl gathers toward the end — the old leaves run out low and
        // then stand up — and the leaf is aimed and sized so that, curled,
        // its tip still lands on the dome.
        const curl = (75 - 66 * t + (rng() - 0.5) * 8) * deg;
        const angle = (s: number) => e0 + curl * Math.pow(s, 1.8);
        const reach = () => {
          let dr = 0;
          let dy = 0;
          for (let j = 1; j < TC_PTS; j++) {
            const e = angle((TC_ALONG[j - 1] + TC_ALONG[j]) / 2);
            dr += Math.cos(e) * (TC_ALONG[j] - TC_ALONG[j - 1]) * len;
            dy += Math.sin(e) * (TC_ALONG[j] - TC_ALONG[j - 1]) * len;
          }
          return [dr, dy];
        };
        const want = Math.atan2(tipY - y0, tipR - r0);
        const far = Math.hypot(tipR - r0, tipY - y0);
        let e0 = want;
        let len = far;
        for (let k = 0; k < 8; k++) {
          const [dr, dy] = reach();
          e0 += want - Math.atan2(dy, dr);
          len *= far / Math.hypot(dr, dy);
        }
        const hw = 0.34 * (1 - 0.45 * t) * (0.9 + 0.2 * rng());
        const az = i * 2.39996 + (rng() - 0.5) * 0.2;
        const sway = (rng() - 0.5) * 16 * deg;
        let px = Math.cos(az) * r0;
        let py = y0;
        let pz = Math.sin(az) * r0;
        let prev = 0;
        const frame: number[][] = [];
        for (let j = 0; j < TC_PTS; j++) {
          const s = TC_ALONG[j];
          if (j > 0) {
            const sm = (prev + s) / 2;
            const e = angle(sm);
            const ps = az + sway * sm * sm;
            const step = (s - prev) * len;
            px += Math.cos(e) * Math.cos(ps) * step;
            py = Math.max(0.006, py + Math.sin(e) * step);
            pz += Math.cos(e) * Math.sin(ps) * step;
          }
          prev = s;
          // Along the leaf; across it, level; up off its upper face.
          const e = angle(s);
          const ps = az + sway * s * s;
          const T = [Math.cos(e) * Math.cos(ps), Math.sin(e), Math.cos(e) * Math.sin(ps)];
          const S = [-Math.sin(ps), 0, Math.cos(ps)];
          const N = [-Math.cos(ps) * Math.sin(e), Math.cos(e), -Math.sin(ps) * Math.sin(e)];
          const w = hw * TC_WIDE[j];
          const cup = 0.24 * w;
          const keel = 0.14 * w;
          leaf.set(
            [
              px, py, pz,
              px + S[0] * w + N[0] * cup, py + N[1] * cup, pz + S[2] * w + N[2] * cup,
              px - S[0] * w + N[0] * cup, py + N[1] * cup, pz - S[2] * w + N[2] * cup,
              px - N[0] * keel, py - N[1] * keel, pz - N[2] * keel,
            ],
            (i * TC_PTS + j) * 12,
          );
          frame.push([...T, ...S, ...N]);
          top = Math.max(top, py);
        }
        // The terminal spine: short and stout, straight on from the tip.
        const T = frame[TC_PTS - 1];
        const tip = (i * TC_PTS + TC_PTS - 1) * 12;
        const sl = 0.06;
        spine.set([leaf[tip], leaf[tip + 1], leaf[tip + 2], leaf[tip] + T[0] * sl, leaf[tip + 1] + T[1] * sl, leaf[tip + 2] + T[2] * sl], i * 6);
        // Fine teeth down the outer two-thirds of both margins.
        for (let side = 0; side < 2; side++) {
          const sg = side === 0 ? 1 : -1;
          for (let k2 = 0; k2 < TC_TEETH; k2++) {
            const s = 0.2 + (0.68 * (k2 + 0.3 + rng() * 0.4)) / TC_TEETH;
            let j = 0;
            while (j < TC_PTS - 2 && TC_ALONG[j + 1] < s) j++;
            const fr = (s - TC_ALONG[j]) / (TC_ALONG[j + 1] - TC_ALONG[j]);
            const a = (i * TC_PTS + j) * 12 + 3 + side * 3;
            const b = a + 12;
            const [Tx, Ty, Tz, Sx, , Sz, Nx, Ny, Nz] = frame[j];
            const size = hw / 0.34;
            const out = 0.02 * size;
            const foot = 0.011 * size;
            teeth.set(
              [
                leaf[a] + (leaf[b] - leaf[a]) * fr,
                leaf[a + 1] + (leaf[b + 1] - leaf[a + 1]) * fr,
                leaf[a + 2] + (leaf[b + 2] - leaf[a + 2]) * fr,
                (Sx * sg * 0.8 + Nx * 0.35 + Tx * 0.4) * out,
                (Ny * 0.35 + Ty * 0.4) * out,
                (Sz * sg * 0.8 + Nz * 0.35 + Tz * 0.4) * out,
                Tx * foot,
                Ty * foot,
                Tz * foot,
              ],
              ((i * 2 + side) * TC_TEETH + k2) * 9,
            );
            toothHalf[(i * 2 + side) * TC_TEETH + k2] = s < TC_ALONG[TC_SPLIT] ? 0 : 1;
          }
        }
      }
      // The tallest leaf tip to the full height.
      const ys = 1 / top;
      for (let k = 1; k < leaf.length; k += 3) leaf[k] *= ys;
      for (let k = 1; k < teeth.length; k += 3) teeth[k] *= ys;
      for (let k = 1; k < spine.length; k += 3) spine[k] *= ys;
      return { leaf, teeth, toothHalf, spine, core: [0, 0.36 * ys, 0] };
    })();

    // Grown once per plant and kept, as the trees are.
    type TruncataPlant = {
      /** the leaves' lines, turned, scaled and placed */
      leaf: Float32Array;
      /** each face's outward normal, its middle and its tone */
      faceN: Float32Array;
      faceMid: Float32Array;
      faceTone: Uint8Array;
      teeth: Float32Array;
      spine: Float32Array;
      core: [number, number, number];
    };
    const truncataGrown = new Map<string, TruncataPlant>();
    // The packed leaf bases inside, as a cone in the model's measure: rings
    // of (radius, height) round the middle. It stays under the old leaves,
    // which run out low, and fills what's seen past their tips.
    const TC_DOME_AROUND = 16;
    const TC_DOME = (() => {
      const rings = [
        [0.52, 0],
        [0.42, 0.15],
        [0.3, 0.32],
        [0.16, 0.5],
        [0.04, 0.62],
      ];
      const pts = new Float32Array(rings.length * TC_DOME_AROUND * 3);
      rings.forEach(([r, y], k) => {
        for (let a = 0; a < TC_DOME_AROUND; a++) {
          const th = (a / TC_DOME_AROUND) * Math.PI * 2;
          pts.set([Math.cos(th) * r, y, Math.sin(th) * r], (k * TC_DOME_AROUND + a) * 3);
        }
      });
      return pts;
    })();
    // Scratch, reused plant to plant.
    const tcDomeX = new Float32Array(TC_DOME.length / 3);
    const tcDomeY = new Float32Array(TC_DOME.length / 3);
    const tcDomeIdx: number[] = Array.from({ length: TC_DOME.length / 3 }, (_, i) => i);
    const tcHull: number[] = [];
    const tcOrder: number[] = [];
    const tcDepth = new Float32Array(TC_FACES);
    const tcVis = new Uint8Array(TC_FACES);
    const tcDone = new Uint8Array(TC_FACES);

    function growTruncata(x: number, z: number, h: number, rot: number): TruncataPlant {
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      type V3 = [number, number, number];
      const level = (n: V3) =>
        Math.max(0, Math.min(TC_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (TC_LEVELS - 1))));
      const unit = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const turn = (src: Float32Array, dst: Float32Array, o: number, offset: boolean) => {
        const mx = src[o];
        const mz = src[o + 2];
        dst[o] = (offset ? x : 0) + (mx * cr - mz * sr) * h;
        dst[o + 1] = src[o + 1] * h;
        dst[o + 2] = (offset ? z : 0) + (mx * sr + mz * cr) * h;
      };

      const leaf = new Float32Array(TC_MODEL.leaf.length);
      for (let o = 0; o < leaf.length; o += 3) turn(TC_MODEL.leaf, leaf, o, true);
      const teeth = new Float32Array(TC_MODEL.teeth.length);
      for (let o = 0; o < teeth.length; o += 9) {
        turn(TC_MODEL.teeth, teeth, o, true);
        turn(TC_MODEL.teeth, teeth, o + 3, false);
        turn(TC_MODEL.teeth, teeth, o + 6, false);
      }
      const spine = new Float32Array(TC_MODEL.spine.length);
      for (let o = 0; o < spine.length; o += 3) turn(TC_MODEL.spine, spine, o, true);
      // Each face lit by its normal halfway along its half, pointed away
      // from the middle of the leaf's section.
      const faceN = new Float32Array(TC_FACES * 3);
      const faceMid = new Float32Array(TC_FACES * 3);
      const faceTone = new Uint8Array(TC_FACES);
      const pt = (i: number, j: number, line: number, k: number) => leaf[(i * TC_PTS + j) * 12 + line * 3 + k];
      for (let i = 0; i < TC_LEAVES; i++) {
        for (let g = 0; g < 2; g++) {
          const m = g === 0 ? 2 : 6;
          const along: V3 = [0, 1, 2].map((k) => pt(i, m + 1, 0, k) - pt(i, m - 1, 0, k)) as V3;
          const middle: V3 = [0, 1, 2].map((k) => pt(i, m, 0, k) * 0.6 + pt(i, m, 3, k) * 0.4) as V3;
          for (let f = 0; f < 4; f++) {
            const [la, lb] = TC_FACE_LINES[f];
            const a: V3 = [0, 1, 2].map((k) => pt(i, m, la, k)) as V3;
            const b: V3 = [0, 1, 2].map((k) => pt(i, m, lb, k)) as V3;
            const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let n = unit([along[1] * ac[2] - along[2] * ac[1], along[2] * ac[0] - along[0] * ac[2], along[0] * ac[1] - along[1] * ac[0]]);
            const out = [(a[0] + b[0]) / 2 - middle[0], (a[1] + b[1]) / 2 - middle[1], (a[2] + b[2]) / 2 - middle[2]];
            if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
            const fi = (i * 2 + g) * 4 + f;
            faceN.set(n, fi * 3);
            for (let k = 0; k < 3; k++) faceMid[fi * 3 + k] = (a[k] + b[k]) / 2;
            faceTone[fi] = (f < 2 ? 0 : TC_LEVELS) + level(n);
          }
        }
      }
      const c = TC_MODEL.core;
      return { leaf, faceN, faceMid, faceTone, teeth, spine, core: [x + c[0] * h, c[1] * h, z + c[2] * h] };
    }

    /** Agave truncata, the artichoke agave, after the app's model.
     *
     *  A tight, symmetrical dome of thirty-four short, broad, thick leaves of
     *  nearly one length, pale glaucous blue-grey above and creamy sage
     *  behind, cupped like spoons and overlapping like the bracts of an
     *  artichoke; each cut short to a stout red-brown spine, with fine teeth
     *  down its margins.
     *
     *  The dark inside goes down first. Each leaf is a solid of four faces —
     *  the two halves of the cupped upper face over a keeled back — cut in
     *  two along its length, so the end that stands up shows its back and
     *  the run beneath it doesn't; every face toward the eye in one
     *  far-to-near sort. Then its margin, its teeth and its spine, as soon
     *  as they'd show. Grown once and cached; drawn through the local map at
     *  the heart.
     */
    function drawTruncataBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = truncataGrown.get(key);
      if (!grown) {
        if (truncataGrown.size > 400) truncataGrown.clear(); // growth and edits mint new keys
        grown = growTruncata(x, z, h, rot);
        truncataGrown.set(key, grown);
      }
      const { leaf, faceN, faceMid, faceTone, teeth, spine, core } = grown;
      const pal = sel ? TRUNCATA_GOLD : TRUNCATA_COLOURS;
      const tones = TC_TONES[sel ? 1 : 0];

      // The local map at the heart: screen x, y and depth per foot.
      const q = P(core[0], core[1], core[2]);
      const qx = P(core[0] + 1, core[1], core[2]);
      const qy = P(core[0], core[1] + 1, core[2]);
      const qz = P(core[0], core[1], core[2] + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const footPx = Math.hypot(J[1], J[4]);
      const sxOf = (o: Float32Array, i: number) =>
        q[0] + J[0] * (o[i] - core[0]) + J[1] * (o[i + 1] - core[1]) + J[2] * (o[i + 2] - core[2]);
      const syOf = (o: Float32Array, i: number) =>
        q[1] + J[3] * (o[i] - core[0]) + J[4] * (o[i + 1] - core[1]) + J[5] * (o[i + 2] - core[2]);
      const depthOf = (o: Float32Array, i: number) =>
        q[2] + J[6] * (o[i] - core[0]) + J[7] * (o[i + 1] - core[1]) + J[8] * (o[i + 2] - core[2]);

      // The shadowed inside, packed with leaf bases, first — the outline of
      // the dome as seen, so whatever shows between the leaves is dark, as
      // it is on the plant, and never the ground.
      {
        const n = tcDomeX.length;
        for (let k = 0; k < n; k++) {
          const dx = TC_DOME[k * 3] * h;
          const dy = TC_DOME[k * 3 + 1] * h - core[1];
          const dz = TC_DOME[k * 3 + 2] * h;
          tcDomeX[k] = q[0] + J[0] * dx + J[1] * dy + J[2] * dz;
          tcDomeY[k] = q[1] + J[3] * dx + J[4] * dy + J[5] * dz;
        }
        tcDomeIdx.sort((a, b) => tcDomeX[a] - tcDomeX[b] || tcDomeY[a] - tcDomeY[b]);
        // Andrew's monotone chain: lower run, then upper.
        const cross = (o: number, a: number, b: number) =>
          (tcDomeX[a] - tcDomeX[o]) * (tcDomeY[b] - tcDomeY[o]) - (tcDomeY[a] - tcDomeY[o]) * (tcDomeX[b] - tcDomeX[o]);
        tcHull.length = 0;
        for (const k of tcDomeIdx) {
          while (tcHull.length >= 2 && cross(tcHull[tcHull.length - 2], tcHull[tcHull.length - 1], k) <= 0) tcHull.pop();
          tcHull.push(k);
        }
        const lower = tcHull.length + 1;
        for (let m = n - 2; m >= 0; m--) {
          const k = tcDomeIdx[m];
          while (tcHull.length >= lower && cross(tcHull[tcHull.length - 2], tcHull[tcHull.length - 1], k) <= 0) tcHull.pop();
          tcHull.push(k);
        }
        ctx!.beginPath();
        ctx!.moveTo(tcDomeX[tcHull[0]], tcDomeY[tcHull[0]]);
        for (let m = 1; m < tcHull.length - 1; m++) ctx!.lineTo(tcDomeX[tcHull[m]], tcDomeY[tcHull[m]]);
        ctx!.closePath();
        ctx!.fillStyle = pal.core;
        ctx!.fill();
      }

      // Faces toward the eye, far to near.
      tcOrder.length = 0;
      for (let f = 0; f < TC_FACES; f++) {
        const o = f * 3;
        const vis =
          faceN[o] * (eye[0] - faceMid[o]) + faceN[o + 1] * (eye[1] - faceMid[o + 1]) + faceN[o + 2] * (eye[2] - faceMid[o + 2]) > 0;
        tcVis[f] = vis ? 1 : 0;
        tcDone[f] = 0;
        if (!vis) continue;
        tcDepth[f] = depthOf(faceMid, o);
        tcOrder.push(f);
      }
      tcOrder.sort((a, b) => tcDepth[b] - tcDepth[a]);

      const margins = footPx * h > 60;
      const toothed = footPx * h > 130;
      const marginW = Math.max(footPx * h * 0.004, 0.6);
      for (const it of tcOrder) {
        const i = it >> 3;
        const g = (it >> 2) & 1;
        const f = it & 3;
        const [la, lb] = TC_FACE_LINES[f];
        const base = i * TC_PTS * 12;
        const j0 = g === 0 ? 0 : TC_SPLIT;
        const j1 = g === 0 ? TC_SPLIT : TC_PTS - 1;
        ctx!.beginPath();
        for (let j = j0; j <= j1; j++) {
          const o = base + j * 12 + la * 3;
          if (j === j0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
          else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
        }
        for (let j = j1; j >= j0; j--) {
          const o = base + j * 12 + lb * 3;
          ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
        }
        ctx!.closePath();
        ctx!.fillStyle = tones[faceTone[it]];
        ctx!.fill();
        tcDone[it] = 1;
        // The margin this face shares with its partner above or below,
        // its teeth, and — once per leaf, with the last of its faces to
        // show — the spine.
        const partner = it ^ 2;
        if (margins && !(tcVis[partner] && !tcDone[partner])) {
          const line = f === 0 || f === 2 ? 1 : 2;
          ctx!.beginPath();
          for (let j = j0; j <= j1; j++) {
            const o = base + j * 12 + line * 3;
            if (j === j0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
            else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          ctx!.strokeStyle = pal.margin;
          ctx!.lineWidth = marginW;
          ctx!.stroke();
          if (toothed) {
            ctx!.beginPath();
            for (let k = 0; k < TC_TEETH; k++) {
              if (TC_MODEL.toothHalf[(i * 2 + line - 1) * TC_TEETH + k] !== g) continue;
              const o = ((i * 2 + line - 1) * TC_TEETH + k) * 9;
              const mx = sxOf(teeth, o);
              const my = syOf(teeth, o);
              const ox = J[0] * teeth[o + 3] + J[1] * teeth[o + 4] + J[2] * teeth[o + 5];
              const oy = J[3] * teeth[o + 3] + J[4] * teeth[o + 4] + J[5] * teeth[o + 5];
              const ax = J[0] * teeth[o + 6] + J[1] * teeth[o + 7] + J[2] * teeth[o + 8];
              const ay = J[3] * teeth[o + 6] + J[4] * teeth[o + 7] + J[5] * teeth[o + 8];
              ctx!.moveTo(mx - ax, my - ay);
              ctx!.lineTo(mx + ax, my + ay);
              ctx!.lineTo(mx + ox + ax * 0.8, my + oy + ay * 0.8);
              ctx!.closePath();
            }
            ctx!.fillStyle = pal.teeth;
            ctx!.fill();
          }
        }
        let last = true;
        for (let k = i * 8; k < i * 8 + 8; k++) if (tcVis[k] && !tcDone[k]) last = false;
        if (last) {
          // A thorn: broad where it leaves the leaf, to a point.
          const ax = sxOf(spine, i * 6);
          const ay = syOf(spine, i * 6);
          const bx = sxOf(spine, i * 6 + 3);
          const by = syOf(spine, i * 6 + 3);
          const l = Math.hypot(bx - ax, by - ay) || 1;
          const half = Math.max(footPx * h * 0.011, 0.6) / l;
          ctx!.beginPath();
          ctx!.moveTo(ax - (by - ay) * half - (bx - ax) * 0.25, ay + (bx - ax) * half - (by - ay) * 0.25);
          ctx!.lineTo(bx, by);
          ctx!.lineTo(ax + (by - ay) * half - (bx - ax) * 0.25, ay - (bx - ax) * half - (by - ay) * 0.25);
          ctx!.closePath();
          ctx!.fillStyle = pal.spine;
          ctx!.fill();
        }
      }
      ctx!.lineWidth = lw;
    }

    // The model's canes, as splayed to the species' 12 ft: per cane nine
    // points up its axis from the crown — x and z across the spread (1 = the
    // plant's radius), y up its height (1 = the plant's height) — its
    // half-girth at the crown and at the tip in thousandths of the radius,
    // and 1 where it ends in a flower spike.
    const OC_CANES: [number[], number, number, number][] = [
      [[0.082, 0.005, -0.072, 0.132, 0.101, -0.083, 0.235, 0.197, -0.086, 0.337, 0.292, -0.069, 0.435, 0.388, -0.078, 0.52, 0.484, -0.143, 0.587, 0.58, -0.249, 0.66, 0.676, -0.352, 0.73, 0.771, -0.395], 15, 4, 0],
      [[-0.04, 0.004, -0.094, -0.126, 0.113, -0.15, -0.251, 0.223, -0.199, -0.383, 0.333, -0.224, -0.505, 0.442, -0.242, -0.599, 0.552, -0.283, -0.656, 0.661, -0.361, -0.69, 0.771, -0.466, -0.722, 0.881, -0.554], 11, 2, 1],
      [[0.032, 0.005, -0.018, 0.026, 0.1, -0.014, 0.012, 0.195, 0.016, -0.002, 0.291, 0.088, 0.007, 0.386, 0.19, 0.05, 0.481, 0.322, 0.134, 0.576, 0.497, 0.226, 0.672, 0.688, 0.301, 0.767, 0.886], 16, 3, 0],
      [[0.024, 0.005, -0.078, 0.005, 0.123, -0.072, -0.006, 0.241, -0.066, 0.034, 0.359, -0.061, 0.135, 0.476, -0.061, 0.267, 0.594, -0.09, 0.394, 0.712, -0.172, 0.476, 0.829, -0.31, 0.526, 0.947, -0.477], 16, 3, 1],
      [[-0.055, 0.003, -0.03, -0.162, 0.116, -0.01, -0.282, 0.228, 0.017, -0.402, 0.341, 0.088, -0.478, 0.453, 0.18, -0.55, 0.566, 0.296, -0.625, 0.678, 0.363, -0.707, 0.791, 0.354, -0.809, 0.903, 0.305], 15, 3, 0],
      [[0.052, 0.004, -0.02, 0.092, 0.105, 0.021, 0.16, 0.206, 0.064, 0.247, 0.307, 0.105, 0.319, 0.408, 0.153, 0.361, 0.509, 0.215, 0.383, 0.61, 0.306, 0.401, 0.711, 0.392, 0.425, 0.812, 0.447], 14, 4, 0],
      [[-0.013, 0.004, -0.113, -0.06, 0.108, -0.167, -0.113, 0.211, -0.231, -0.137, 0.314, -0.317, -0.112, 0.418, -0.419, -0.062, 0.521, -0.524, -0.024, 0.625, -0.624, -0.056, 0.728, -0.696, -0.111, 0.832, -0.721], 13, 4, 1],
      [[0.011, 0.004, -0.042, 0.023, 0.123, -0.063, 0.025, 0.243, -0.088, 0.01, 0.362, -0.089, -0.004, 0.481, -0.047, -0.002, 0.6, 0.05, 0.002, 0.719, 0.215, -0.032, 0.839, 0.392, -0.084, 0.958, 0.502], 18, 4, 0],
      [[0.051, 0.005, -0.06, 0.04, 0.119, -0.048, 0.036, 0.233, -0.037, 0.056, 0.347, -0.044, 0.114, 0.461, -0.084, 0.198, 0.575, -0.15, 0.303, 0.689, -0.232, 0.43, 0.803, -0.321, 0.57, 0.917, -0.406], 15, 4, 1],
      [[-0.018, 0.008, -0.072, -0.007, 0.11, -0.062, 0.004, 0.213, -0.065, 0.003, 0.315, -0.089, -0.019, 0.417, -0.137, -0.077, 0.519, -0.193, -0.177, 0.622, -0.24, -0.305, 0.724, -0.263, -0.442, 0.826, -0.27], 17, 3, 0],
      [[0.033, 0.005, -0.046, 0.04, 0.115, -0.043, 0.048, 0.225, -0.031, 0.046, 0.335, 0.016, 0.034, 0.444, 0.103, 0.021, 0.554, 0.228, 0.024, 0.664, 0.384, 0.06, 0.773, 0.556, 0.105, 0.883, 0.682], 13, 3, 0],
      [[0.034, 0.007, -0.077, 0.019, 0.121, -0.054, -0.004, 0.235, -0.048, -0.03, 0.348, -0.07, -0.006, 0.462, -0.11, 0.093, 0.576, -0.159, 0.255, 0.69, -0.217, 0.402, 0.804, -0.303, 0.479, 0.918, -0.384], 15, 4, 0],
      [[-0.032, 0.004, -0.005, -0.097, 0.119, 0.041, -0.205, 0.233, 0.102, -0.317, 0.347, 0.147, -0.453, 0.462, 0.202, -0.567, 0.576, 0.268, -0.659, 0.69, 0.353, -0.743, 0.805, 0.462, -0.798, 0.919, 0.54], 14, 4, 0],
      [[0.083, 0.004, -0.05, 0.168, 0.101, -0.052, 0.278, 0.199, -0.058, 0.391, 0.297, -0.059, 0.484, 0.394, -0.045, 0.554, 0.492, -0.016, 0.611, 0.59, 0.027, 0.663, 0.687, 0.074, 0.699, 0.785, 0.104], 13, 5, 0],
      [[0.012, 0.005, -0.056, 0.007, 0.09, -0.037, 0.002, 0.175, -0.014, -0.029, 0.259, -0.025, -0.062, 0.344, -0.08, -0.108, 0.429, -0.201, -0.179, 0.514, -0.342, -0.301, 0.599, -0.479, -0.454, 0.684, -0.579], 16, 2, 1],
      [[0.012, 0.008, -0.021, 0.004, 0.127, -0.053, -0.002, 0.246, -0.072, 0.002, 0.365, -0.056, 0.013, 0.483, 0.003, 0.023, 0.602, 0.112, 0.017, 0.721, 0.254, -0.024, 0.84, 0.44, -0.081, 0.959, 0.587], 18, 4, 0],
      [[0.072, 0.008, -0.095, 0.131, 0.111, -0.137, 0.215, 0.214, -0.177, 0.307, 0.317, -0.209, 0.375, 0.42, -0.24, 0.413, 0.523, -0.288, 0.416, 0.626, -0.364, 0.393, 0.729, -0.468, 0.365, 0.832, -0.564], 14, 4, 0],
      [[-0.027, 0.008, -0.056, -0.079, 0.124, -0.065, -0.142, 0.24, -0.071, -0.208, 0.356, -0.053, -0.264, 0.471, -0.002, -0.298, 0.587, 0.048, -0.328, 0.703, 0.087, -0.35, 0.819, 0.092, -0.372, 0.934, 0.07], 17, 5, 1],
      [[0.081, 0.005, -0.009, 0.126, 0.118, 0.038, 0.197, 0.232, 0.089, 0.292, 0.345, 0.128, 0.35, 0.459, 0.152, 0.378, 0.572, 0.195, 0.367, 0.686, 0.288, 0.327, 0.799, 0.406, 0.306, 0.913, 0.467], 12, 5, 0],
      [[0.018, 0.003, -0.136, 0.012, 0.115, -0.268, 0.002, 0.227, -0.405, -0.001, 0.339, -0.559, 0.018, 0.451, -0.677, 0.067, 0.563, -0.785, 0.137, 0.675, -0.858, 0.228, 0.787, -0.93, 0.298, 0.899, -0.981], 12, 3, 0],
      [[-0.01, 0.004, -0.01, -0.041, 0.124, 0.049, -0.106, 0.245, 0.136, -0.196, 0.365, 0.211, -0.298, 0.486, 0.288, -0.387, 0.607, 0.388, -0.435, 0.727, 0.528, -0.437, 0.848, 0.719, -0.418, 0.968, 0.906], 13, 3, 1],
      [[0.07, 0.007, -0.07, 0.055, 0.1, -0.074, 0.05, 0.192, -0.1, 0.075, 0.285, -0.145, 0.139, 0.377, -0.198, 0.253, 0.469, -0.25, 0.405, 0.562, -0.288, 0.607, 0.654, -0.318, 0.79, 0.747, -0.341], 20, 4, 0],
      [[0.002, 0.004, -0.068, 0.017, 0.055, -0.075, 0.014, 0.106, -0.085, -0.025, 0.157, -0.103, -0.107, 0.209, -0.132, -0.225, 0.26, -0.181, -0.372, 0.311, -0.264, -0.535, 0.362, -0.394, -0.655, 0.413, -0.516], 16, 3, 0],
      [[0.039, 0.004, -0.02, 0.073, 0.066, 0.05, 0.09, 0.127, 0.156, 0.083, 0.188, 0.267, 0.085, 0.249, 0.36, 0.114, 0.31, 0.417, 0.181, 0.371, 0.449, 0.255, 0.433, 0.476, 0.288, 0.494, 0.506], 13, 4, 1],
      [[0.047, 0.004, -0.093, 0.07, 0.05, -0.093, 0.086, 0.096, -0.11, 0.105, 0.142, -0.169, 0.134, 0.188, -0.266, 0.19, 0.234, -0.376, 0.301, 0.281, -0.504, 0.452, 0.327, -0.608, 0.653, 0.373, -0.702], 16, 3, 0],
      [[-0.026, 0.003, -0.038, 0.022, 0.048, -0.046, 0.063, 0.092, -0.046, 0.056, 0.137, -0.051, -0.009, 0.182, -0.076, -0.112, 0.227, -0.109, -0.283, 0.272, -0.147, -0.481, 0.317, -0.145, -0.661, 0.362, -0.096], 11, 2, 0],
      [[0.027, 0.007, -0.047, -0.008, 0.12, -0.05, -0.062, 0.232, -0.05, -0.076, 0.344, -0.058, -0.047, 0.457, -0.091, 0.042, 0.569, -0.158, 0.134, 0.682, -0.195, 0.264, 0.794, -0.191, 0.324, 0.907, -0.154], 17, 4, 0],
      [[0.002, 0.004, -0.11, -0.007, 0.104, -0.173, 0.007, 0.204, -0.245, 0.025, 0.304, -0.304, 0.02, 0.403, -0.327, -0.027, 0.503, -0.317, -0.09, 0.603, -0.278, -0.138, 0.703, -0.223, -0.139, 0.803, -0.196], 11, 3, 0],
      [[0.013, 0.008, -0.036, 0.007, 0.097, -0.084, -0.007, 0.185, -0.135, -0.034, 0.274, -0.172, -0.034, 0.362, -0.157, -0.021, 0.451, -0.105, -0.003, 0.539, -0.016, -0.003, 0.628, 0.089, -0.036, 0.717, 0.204], 13, 2, 0],
      [[0.056, 0.007, -0.078, 0.113, 0.11, -0.109, 0.165, 0.213, -0.158, 0.194, 0.316, -0.205, 0.213, 0.419, -0.242, 0.228, 0.523, -0.238, 0.259, 0.626, -0.185, 0.309, 0.729, -0.081, 0.365, 0.832, 0.037], 11, 2, 0],
      [[-0.013, 0.004, -0.061, 0.045, 0.093, -0.029, 0.1, 0.182, -0.012, 0.135, 0.271, -0.023, 0.15, 0.361, -0.056, 0.117, 0.45, -0.092, 0.052, 0.539, -0.095, -0.052, 0.628, -0.063, -0.168, 0.717, -0.002], 12, 3, 0],
      [[0.034, 0.005, -0.036, -0, 0.105, -0.066, -0.041, 0.206, -0.092, -0.059, 0.306, -0.097, -0.047, 0.407, -0.093, 0.01, 0.508, -0.08, 0.124, 0.608, -0.048, 0.244, 0.709, 0.007, 0.32, 0.809, 0.061], 12, 3, 0],
      [[0.01, 0.005, -0.093, 0.017, 0.104, -0.076, 0.031, 0.203, -0.05, 0.061, 0.302, -0.041, 0.086, 0.401, -0.055, 0.081, 0.5, -0.095, 0.033, 0.599, -0.156, -0.059, 0.698, -0.24, -0.119, 0.797, -0.294], 19, 5, 0],
      [[-0.023, 0.008, -0.031, -0.069, 0.095, 0.006, -0.128, 0.183, 0.055, -0.184, 0.271, 0.081, -0.239, 0.359, 0.063, -0.286, 0.446, 0.012, -0.311, 0.534, -0.038, -0.301, 0.622, -0.045, -0.275, 0.709, -0.02], 16, 4, 0],
    ];
    type OcotilloCane = {
      /** the axis, 9 points, feet */
      ax: Float32Array;
      /** half-girth at each axis point, feet */
      r: Float32Array;
      /** leaves, 8 numbers each: where along the axis (0–8), the leaf's
       *  base and tip as offsets from there (feet), its tone (4 = yellowing) */
      leaves: Float32Array;
      /** flower tubes at the tip, 7 numbers each: base and tip offsets from
       *  the cane's tip, lit or not */
      flowers: Float32Array;
      /** how far a flower spike stands past the tip, feet */
      spike: number;
    };
    type OcotilloPlant = { canes: OcotilloCane[]; leafLen: number; tube: number };
    const ocotilloGrown = new Map<string, OcotilloPlant>();
    // Scratch for one cane's projected axis and depth order.
    const ocSx = new Float32Array(9);
    const ocSy = new Float32Array(9);
    const ocDepth = new Float32Array(OC_CANES.length);
    const ocOrder = new Int32Array(OC_CANES.length);

    function growOcotillo(x: number, z: number, h: number, rw: number, rot: number, seed: string): OcotilloPlant {
      const rng = rngFor("ocotillo:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      // Leaves about two inches long on a grown plant, scaled with it as the
      // app scales its model.
      const leafLen = rw * 0.025;
      const tube = rw * 0.02;
      const canes = OC_CANES.map(([pts, g0, g1, flowering]) => {
        const ax = new Float32Array(27);
        const r = new Float32Array(9);
        for (let i = 0; i < 9; i++) {
          const mx = pts[i * 3];
          const mz = pts[i * 3 + 2];
          ax[i * 3] = x + (mx * cr - mz * sr) * rw;
          ax[i * 3 + 1] = pts[i * 3 + 1] * h;
          ax[i * 3 + 2] = z + (mx * sr + mz * cr) * rw;
          r[i] = ((g0 + ((g1 - g0) * i) / 8) / 1000) * rw;
        }
        // The axis's direction at a point along it.
        const tangent = (i: number): [number, number, number] => {
          const a = Math.max(0, Math.min(7, Math.floor(i)));
          const d = [ax[a * 3 + 3] - ax[a * 3], ax[a * 3 + 4] - ax[a * 3 + 1], ax[a * 3 + 5] - ax[a * 3 + 2]];
          const l = Math.hypot(d[0], d[1], d[2]) || 1;
          return [d[0] / l, d[1] / l, d[2] / l];
        };
        let len = 0;
        for (let i = 1; i < 9; i++)
          len += Math.hypot(ax[i * 3] - ax[i * 3 - 3], ax[i * 3 + 1] - ax[i * 3 - 2], ax[i * 3 + 2] - ax[i * 3 - 1]);
        // Leaves the whole length of the cane, as the model has them, half
        // as many.
        const n = Math.round(len / (rw * 0.008));
        const leaves = new Float32Array(n * 8);
        for (let k = 0; k < n; k++) {
          const along = 8 * (0.03 + (0.96 * (k + rng())) / n);
          const t = tangent(along);
          // Two directions square to the cane, to spin the leaf round it.
          const up = Math.abs(t[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
          let e1 = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
          const l1 = Math.hypot(e1[0], e1[1], e1[2]);
          e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
          const e2 = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
          const a = rng() * Math.PI * 2;
          const rise = 0.3 + 0.5 * rng(); // leaves angle up the cane a little
          const out = [Math.cos(a) * e1[0] + Math.sin(a) * e2[0], Math.cos(a) * e1[1] + Math.sin(a) * e2[1], Math.cos(a) * e1[2] + Math.sin(a) * e2[2]];
          let d = [out[0] + t[0] * rise, out[1] + t[1] * rise, out[2] + t[2] * rise];
          const ld = Math.hypot(d[0], d[1], d[2]);
          d = [d[0] / ld, d[1] / ld, d[2] / ld];
          const i0 = Math.min(8, Math.floor(along));
          const rr = r[i0];
          const ll = leafLen * (0.75 + 0.5 * rng());
          // Lit toward the sun and higher up the fan; a few going yellow.
          const lit = 0.5 + 0.5 * (d[0] * LX + d[1] * LY + d[2] * LZ);
          const shade = (0.35 + 0.65 * lit) * (0.7 + 0.3 * (along / 8)) * (0.75 + 0.5 * rng());
          const tone = rng() < 0.04 ? 4 : Math.max(0, Math.min(3, Math.floor(shade * 4)));
          leaves.set([along, out[0] * rr, out[1] * rr, out[2] * rr, out[0] * rr + d[0] * ll, out[1] * rr + d[1] * ll, out[2] * rr + d[2] * ll, tone], k * 8);
        }
        // The spike: a cluster of red tubes up a short bare stalk past the
        // tip, each angled out and up, the lower ones longer.
        const spike = flowering ? rw * 0.09 : 0;
        const fl: number[] = [];
        if (flowering) {
          const t = tangent(7.9);
          for (let k = 0; k < 14; k++) {
            const s = spike * (0.3 + (0.7 * k) / 13);
            const a = rng() * Math.PI * 2;
            const lean = 0.5 + 0.5 * rng();
            let d = [Math.cos(a) * lean + t[0], t[1] + 0.2, Math.sin(a) * lean + t[2]];
            const ld = Math.hypot(d[0], d[1], d[2]);
            d = [d[0] / ld, d[1] / ld, d[2] / ld];
            const tl = tube * (1.1 - 0.5 * (k / 13));
            const b = [t[0] * s, t[1] * s, t[2] * s];
            const lit = d[0] * LX + d[1] * LY + d[2] * LZ > 0.1 ? 1 : 0;
            fl.push(b[0], b[1], b[2], b[0] + d[0] * tl, b[1] + d[1] * tl, b[2] + d[2] * tl, lit);
          }
        }
        return { ax, r, leaves, flowers: new Float32Array(fl), spike };
      });
      return { canes, leafLen, tube };
    }

    /** Ocotillo, after the app's model: in leaf and in flower.
     *
     *  Thirty-four canes out of one woody crown, from the model, splayed as
     *  it is to the species' spread: pale grey whips tapering to the tip,
     *  sleeved their whole length in small bright leaves standing out from
     *  the bark, eight of them ending in a spike of red tubes. A few short
     *  young canes among the tall ones.
     *
     *  Each cane is a dark sleeve, the leaves behind it, the tapered bark,
     *  then the leaves in front and its flowers, canes far to near. Its axis
     *  is projected exactly; its leaves through a local map at the cane.
     *  Far off, where a leaf is under a pixel or two, the sleeve and the bark
     *  carry it. Grown once and cached.
     */
    function drawOcotilloBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = ocotilloGrown.get(key);
      if (!grown) {
        if (ocotilloGrown.size > 400) ocotilloGrown.clear(); // growth and edits mint new keys
        grown = growOcotillo(x, z, h, rw, rot, seed);
        ocotilloGrown.set(key, grown);
      }
      const pal = sel ? OCOTILLO_GOLD : OCOTILLO_COLOURS;
      const { canes, leafLen, tube } = grown;

      // The crown: the one woody knot the canes come out of, a ring on the
      // ground a little wider than the canes' feet.
      ctx!.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const q = P(x + Math.cos(a) * rw * 0.07, 0, z + Math.sin(a) * rw * 0.07);
        if (i) ctx!.lineTo(q[0], q[1]);
        else ctx!.moveTo(q[0], q[1]);
      }
      ctx!.fillStyle = pal.crown;
      ctx!.fill();

      for (let k = 0; k < canes.length; k++) {
        const a = canes[k].ax;
        ocDepth[k] = P(a[12], a[13], a[14])[2];
        ocOrder[k] = k;
      }
      ocOrder.sort((p, q) => ocDepth[q] - ocDepth[p]);

      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      for (const k of ocOrder) {
        const cane = canes[k];
        const { ax, r, leaves, flowers } = cane;
        for (let i = 0; i < 9; i++) {
          const q = P(ax[i * 3], ax[i * 3 + 1], ax[i * 3 + 2]);
          ocSx[i] = q[0];
          ocSy[i] = q[1];
        }
        // The local map at the cane's middle, for what hangs off the axis.
        const mx = ax[12];
        const my = ax[13];
        const mz = ax[14];
        const q = P(mx, my, mz);
        const qx = P(mx + 1, my, mz);
        const qy = P(mx, my + 1, mz);
        const qz = P(mx, my, mz + 1);
        const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
        const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]), Math.hypot(J[1], J[4]));
        const leafPx = leafLen * footPx;

        const axisPath = () => {
          ctx!.beginPath();
          ctx!.moveTo(ocSx[0], ocSy[0]);
          for (let i = 1; i < 9; i++) ctx!.lineTo(ocSx[i], ocSy[i]);
        };
        // Far off, where a leaf is a pixel or two, a band of green carries
        // them; nearer, a narrower shadow among them.
        const show = leafPx >= 1.5;
        if (leafPx < 4) {
          axisPath();
          ctx!.lineCap = "butt";
          ctx!.lineWidth = Math.max(1, (r[4] * 2 + leafLen * 1.2) * footPx * (show ? 0.6 : 1));
          ctx!.strokeStyle = show ? pal.sleeve : pal.leaf[1];
          ctx!.stroke();
        }
        const leafPaths = (front: boolean, tone: number) => {
          ctx!.beginPath();
          for (let o = 0; o < leaves.length; o += 8) {
            if (leaves[o + 7] !== tone && tone >= 0) continue;
            const far = J[6] * leaves[o + 4] + J[7] * leaves[o + 5] + J[8] * leaves[o + 6] > 0;
            if (far === front) continue;
            const al = leaves[o];
            const i = Math.min(7, al | 0);
            const f = al - i;
            const bx = ocSx[i] + (ocSx[i + 1] - ocSx[i]) * f;
            const by = ocSy[i] + (ocSy[i + 1] - ocSy[i]) * f;
            ctx!.moveTo(bx + J[0] * leaves[o + 1] + J[1] * leaves[o + 2] + J[2] * leaves[o + 3], by + J[3] * leaves[o + 1] + J[4] * leaves[o + 2] + J[5] * leaves[o + 3]);
            ctx!.lineTo(bx + J[0] * leaves[o + 4] + J[1] * leaves[o + 5] + J[2] * leaves[o + 6], by + J[3] * leaves[o + 4] + J[4] * leaves[o + 5] + J[5] * leaves[o + 6]);
          }
        };
        // A leaf is a flat paddle: a square-ended dash half as wide as long.
        ctx!.lineCap = "butt";
        const leafW = Math.max(0.8, leafPx * 0.55);
        if (show) {
          leafPaths(false, -1);
          ctx!.lineWidth = leafW;
          ctx!.strokeStyle = pal.leafBack;
          ctx!.stroke();
        }

        // The bark, tapering: a ribbon a half-girth either side of the axis.
        ctx!.beginPath();
        for (let side = 0; side < 2; side++) {
          for (let s = 0; s < 9; s++) {
            const i = side ? 8 - s : s;
            const i0 = Math.max(0, i - 1);
            const i1 = Math.min(8, i + 1);
            const dx = ocSx[i1] - ocSx[i0];
            const dy = ocSy[i1] - ocSy[i0];
            const dl = Math.hypot(dx, dy) || 1;
            const w = Math.max(0.45, r[i] * footPx) * (side ? -1 : 1);
            const px = ocSx[i] - (dy / dl) * w;
            const py = ocSy[i] + (dx / dl) * w;
            if (s === 0 && side === 0) ctx!.moveTo(px, py);
            else ctx!.lineTo(px, py);
          }
        }
        ctx!.closePath();
        ctx!.fillStyle = pal.bark;
        ctx!.fill();
        // Close up, its lit side.
        if (r[2] * footPx > 2.5) {
          ctx!.beginPath();
          for (let i = 0; i < 9; i++) {
            const i0 = Math.max(0, i - 1);
            const i1 = Math.min(8, i + 1);
            const dx = ocSx[i1] - ocSx[i0];
            const dy = ocSy[i1] - ocSy[i0];
            const dl = Math.hypot(dx, dy) || 1;
            const w = r[i] * footPx * 0.45 * (dy / dl > 0 ? 1 : -1);
            if (i) ctx!.lineTo(ocSx[i] + (dy / dl) * w, ocSy[i] - (dx / dl) * w);
            else ctx!.moveTo(ocSx[i] + (dy / dl) * w, ocSy[i] - (dx / dl) * w);
          }
          ctx!.lineWidth = r[4] * footPx * 0.5;
          ctx!.strokeStyle = pal.barkLit;
          ctx!.stroke();
        }

        if (show) {
          ctx!.lineWidth = leafW;
          for (let t = 0; t < 5; t++) {
            leafPaths(true, t);
            ctx!.strokeStyle = pal.leaf[t];
            ctx!.stroke();
          }
        }

        // The flower spike: its stalk on past the tip, then the tubes; far
        // off a fleck of red, never under a pixel and a bit.
        if (cane.spike) {
          const tx = ocSx[8];
          const ty = ocSy[8];
          const tubePx = tube * footPx;
          if (tubePx < 2) {
            // A flame on the end of the cane.
            const sx = J[0] * (ax[24] - ax[21]) + J[1] * (ax[25] - ax[22]) + J[2] * (ax[26] - ax[23]);
            const sy = J[3] * (ax[24] - ax[21]) + J[4] * (ax[25] - ax[22]) + J[5] * (ax[26] - ax[23]);
            const sl = Math.hypot(sx, sy) || 1;
            const reach = Math.max(2.5, cane.spike * footPx);
            ctx!.beginPath();
            ctx!.moveTo(tx, ty);
            ctx!.lineTo(tx + (sx / sl) * reach, ty + (sy / sl) * reach);
            ctx!.lineCap = "round";
            ctx!.lineWidth = Math.max(1.4, cane.spike * footPx * 0.3);
            ctx!.strokeStyle = pal.flowerLit;
            ctx!.stroke();
          } else {
            ctx!.lineCap = "round";
            ctx!.lineWidth = Math.max(0.8, tubePx * 0.45);
            for (let lit = 0; lit < 2; lit++) {
              ctx!.beginPath();
              for (let o = 0; o < flowers.length; o += 7) {
                if (flowers[o + 6] !== lit) continue;
                ctx!.moveTo(tx + J[0] * flowers[o] + J[1] * flowers[o + 1] + J[2] * flowers[o + 2], ty + J[3] * flowers[o] + J[4] * flowers[o + 1] + J[5] * flowers[o + 2]);
                ctx!.lineTo(tx + J[0] * flowers[o + 3] + J[1] * flowers[o + 4] + J[2] * flowers[o + 5], ty + J[3] * flowers[o + 3] + J[4] * flowers[o + 4] + J[5] * flowers[o + 5]);
              }
              ctx!.strokeStyle = lit ? pal.flowerLit : pal.flower;
              ctx!.stroke();
            }
          }
        }
      }
      ctx!.lineCap = "butt";
      ctx!.lineJoin = "miter";
    }

    type YuccaPlant = {
      /** the ball's middle, feet */
      gy: number;
      /** blades, 7 numbers each: base and tip as offsets from the ball's
       *  middle (feet), tone 0–4 */
      blades: Float32Array;
      /** dead leaves on the skirt, 8 each: top and tip as offsets from the
       *  skirt's middle (feet), tone 0–2, how far it curls to one side */
      straw: Float32Array;
      /** the skirt's middle, feet up */
      sy: number;
      /** the skirt's outline, height and radius in feet, bottom up */
      skirt: number[];
      bladeLen: number;
      bladeW: number;
      strawLen: number;
      trunkR: number;
      trunkTop: number;
      coreR: number;
    };
    const yuccaGrown = new Map<string, YuccaPlant>();
    // Scratch for one plant's blades this frame: where each lands on
    // screen, and the passes they go in, each blade sorted into its pass.
    const ybx = new Float32Array(1500);
    const yby = new Float32Array(1500);
    const ytx = new Float32Array(1500);
    const yty = new Float32Array(1500);
    const yuccaKey = new Int8Array(1500);
    const yuccaOrder = new Int16Array(1500);
    const yuccaStart = new Int32Array(26);
    const yuccaAt = new Int32Array(26);
    // The app's mature model, metres: 4.27 tall, 1.40 at the widest radius.
    const BY_H = 4.267;
    const BY_R = 1.3985;

    function growBeakedYucca(h: number, rw: number, rot: number, seed: string): YuccaPlant {
      const rng = rngFor("beakedyucca:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const kx = rw / BY_R;
      const ky = h / BY_H;
      const gyM = 2.69;
      // Blades, as the model's 1,880 run: straight out of a crown on the
      // trunk's head (2.2–3.2 m up), the lowest angled 30° down, the top ones
      // 72° up — the higher on the crown, the steeper — each 1.06–1.39 m.
      const N = 1500;
      const blades = new Float32Array(N * 7);
      for (let k = 0; k < N; k++) {
        const t = (k + rng()) / N;
        const e = ((-30 + 102 * t) * Math.PI) / 180;
        const a = k * 2.39996 + rot + (rng() - 0.5) * 0.4;
        const dx = Math.cos(e) * Math.cos(a);
        const dy = Math.sin(e);
        const dz = Math.cos(e) * Math.sin(a);
        const by = 2.22 + 0.94 * t + (rng() - 0.5) * 0.2 - gyM;
        const len = 1.06 + 0.33 * rng();
        // Lit half by where it is on the ball (the far side of the ball
        // shades it) and half by its face: a flat blade's upper face, square
        // to it and as near up as it can be, catches the sun from above.
        let fx = -dx * dy;
        let fy = 1 - dy * dy;
        let fz = -dz * dy;
        const fl = Math.hypot(fx, fy, fz) || 1;
        fx /= fl;
        fy /= fl;
        fz /= fl;
        const lit = 0.5 + 0.25 * (dx * LX + dy * LY + dz * LZ) + 0.25 * (fx * LX + fy * LY + fz * LZ);
        const shade = (0.4 + 0.6 * lit) * (0.5 + rng());
        blades.set(
          [
            Math.cos(a) * 0.02 * kx,
            by * ky,
            Math.sin(a) * 0.02 * kx,
            (Math.cos(a) * 0.02 + dx * len) * kx,
            (by + dy * len) * ky,
            (Math.sin(a) * 0.02 + dz * len) * kx,
            Math.max(0, Math.min(4, Math.floor(shade * 5))),
          ],
          k * 7,
        );
      }
      // The skirt: last years' leaves hanging straight down the trunk from
      // under the ball, a straw column a little wider at the top.
      const ring: [number, number][] = [
        [0.62, 0.15],
        [0.8, 0.26],
        [1.05, 0.32],
        [1.45, 0.35],
        [1.9, 0.34],
        [2.3, 0.28],
      ];
      const skirt: number[] = [];
      for (const [y, r] of ring) skirt.push(y * ky, r * kx);
      const syM = 1.45;
      const S = 720;
      const straw = new Float32Array(S * 8);
      for (let k = 0; k < S; k++) {
        const y0 = 0.8 + 1.5 * rng();
        let r0 = 0.15;
        for (let i = 1; i < ring.length; i++)
          if (y0 <= ring[i][0]) {
            const f = (y0 - ring[i - 1][0]) / (ring[i][0] - ring[i - 1][0]);
            r0 = ring[i - 1][1] + (ring[i][1] - ring[i - 1][1]) * f;
            break;
          }
        // From the trunk, as the model's do, hanging out to the skirt's edge.
        r0 = 0.15 + (r0 - 0.15) * 0.4;
        const a = rng() * Math.PI * 2;
        const drop = ((60 + 22 * rng()) * Math.PI) / 180;
        const len = Math.min(0.3 + 0.25 * rng(), (y0 - 0.55) / Math.sin(drop));
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const lit = 0.5 + 0.5 * (ca * LX + sa * LZ) * 0.9;
        const tone = Math.max(0, Math.min(2, Math.floor((0.3 + 0.7 * lit) * (0.7 + 0.6 * rng()) * 3)));
        straw.set(
          [
            ca * r0 * kx,
            (y0 - syM) * ky,
            sa * r0 * kx,
            (ca * (r0 + Math.cos(drop) * len)) * kx,
            (y0 - syM - Math.sin(drop) * len) * ky,
            (sa * (r0 + Math.cos(drop) * len)) * kx,
            tone,
            (rng() - 0.5) * 0.5, // dead leaves curl as they dry
          ],
          k * 8,
        );
      }
      return {
        gy: gyM * ky,
        blades,
        straw,
        sy: syM * ky,
        skirt,
        bladeLen: 1.22 * kx,
        bladeW: 0.088 * kx,
        strawLen: 0.42 * kx,
        trunkR: 0.165 * kx,
        trunkTop: 1.0 * ky,
        coreR: 0.55 * kx,
      };
    }

    // The local map at a point: screen and depth per foot along x, y, z.
    function localMap(x: number, y: number, z: number): number[] {
      const q = P(x, y, z);
      const qx = P(x + 1, y, z);
      const qy = P(x, y + 1, z);
      const qz = P(x, y, z + 1);
      return [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2], q[0], q[1]];
    }

    /** Beaked Yucca, after the app's mature model: the clean-trunked globe.
     *
     *  A ball of stiff, straight, dark-green blades radiating from the head
     *  of a short trunk — the lowest angled down, the top ones near upright
     *  — over a skirt of last years' leaves hanging in straw, and below it
     *  a little of the trunk itself, latticed with old leaf bases.
     *
     *  The blades on the far side of the ball first, darker; the trunk and
     *  the skirt; a dark heart; then the near blades, lit toward the sun.
     *  Far off a blade is a stroke; close up a long pointed blade. All
     *  through a local map at the ball and one at the skirt. Grown once and
     *  cached.
     */
    function drawBeakedYuccaBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = yuccaGrown.get(key);
      if (!grown) {
        if (yuccaGrown.size > 400) yuccaGrown.clear(); // growth and edits mint new keys
        grown = growBeakedYucca(h, rw, rot, seed);
        yuccaGrown.set(key, grown);
      }
      const pal = sel ? BEAKED_YUCCA_GOLD : BEAKED_YUCCA_COLOURS;
      const { blades, straw, skirt } = grown;
      const G = localMap(x, grown.gy, z);
      const S = localMap(x, grown.sy, z);
      const gPx = Math.max(Math.hypot(G[0], G[3]), Math.hypot(G[2], G[5]), Math.hypot(G[1], G[4]));
      const sPx = Math.max(Math.hypot(S[0], S[3]), Math.hypot(S[2], S[5]), Math.hypot(S[1], S[4]));
      const wPx = grown.bladeW * gPx;
      // Where the sun falls on screen, for the lit sides.
      const lsx = S[0] * -0.44 + S[2] * -0.43;
      const lsy = S[3] * -0.44 + S[5] * -0.43;
      const lsl = Math.hypot(lsx, lsy) || 1;

      // Each blade once this frame: where it lands, and its pass — the far
      // side of the ball, or how far toward the camera its tip comes in
      // quarters of a blade — by tone.
      const kite = wPx >= 2.4;
      const bladePx = grown.bladeLen * gPx;
      const n = blades.length / 7;
      const dz = grown.bladeLen * Math.hypot(G[6], G[7], G[8]);
      yuccaStart.fill(0);
      for (let o = 0, k = 0; k < n; o += 7, k++) {
        ybx[k] = G[9] + G[0] * blades[o] + G[1] * blades[o + 1] + G[2] * blades[o + 2];
        yby[k] = G[10] + G[3] * blades[o] + G[4] * blades[o + 1] + G[5] * blades[o + 2];
        ytx[k] = G[9] + G[0] * blades[o + 3] + G[1] * blades[o + 4] + G[2] * blades[o + 5];
        yty[k] = G[10] + G[3] * blades[o + 3] + G[4] * blades[o + 4] + G[5] * blades[o + 5];
        const d = -(G[6] * blades[o + 3] + G[7] * blades[o + 4] + G[8] * blades[o + 5]) / dz;
        const band = d < 0 ? 0 : 1 + Math.min(3, Math.floor(d * 4.4));
        yuccaKey[k] = band * 5 + blades[o + 6];
        yuccaStart[yuccaKey[k] + 1]++;
      }
      for (let b = 0; b < 25; b++) yuccaStart[b + 1] += yuccaStart[b];
      yuccaAt.set(yuccaStart);
      for (let k = 0; k < n; k++) yuccaOrder[yuccaAt[yuccaKey[k]]++] = k;

      // A long pointed blade, widest a third of the way out, narrower the
      // more end-on it is to us. Close up it is two halves either side of
      // its keel: side 1 the half to the sun, -1 the other, 0 both.
      const blade = (k: number, side: number) => {
        const bx = ybx[k];
        const by = yby[k];
        const tx = ytx[k];
        const ty = yty[k];
        if (!kite) {
          ctx!.moveTo(bx, by);
          ctx!.lineTo(tx, ty);
          return;
        }
        const ux = tx - bx;
        const uy = ty - by;
        const ul = Math.hypot(ux, uy) || 1;
        const half = wPx * 0.36 * Math.sqrt(Math.min(1, ul / bladePx));
        let nx = (-uy / ul) * half;
        let ny = (ux / ul) * half;
        if (nx * lsx + ny * lsy < 0) {
          nx = -nx;
          ny = -ny;
        }
        const mx = bx + ux * 0.35;
        const my = by + uy * 0.35;
        if (side === 0) {
          ctx!.moveTo(bx + nx * 0.4, by + ny * 0.4);
          ctx!.lineTo(mx + nx, my + ny);
          ctx!.lineTo(tx, ty);
          ctx!.lineTo(mx - nx, my - ny);
          ctx!.lineTo(bx - nx * 0.4, by - ny * 0.4);
        } else {
          ctx!.moveTo(bx, by);
          ctx!.lineTo(bx + nx * 0.4 * side, by + ny * 0.4 * side);
          ctx!.lineTo(mx + nx * side, my + ny * side);
          ctx!.lineTo(tx, ty);
        }
      };
      // One colour's pass: the blades of one or two buckets.
      const pass = (colour: string, b1: number, side1: number, b2: number, side2: number) => {
        if (kite) ctx!.fillStyle = colour;
        else ctx!.strokeStyle = colour;
        ctx!.beginPath();
        let m = 0;
        for (let r = 0; r < 2; r++) {
          const b = r ? b2 : b1;
          if (b < 0) continue;
          const side = r ? side2 : side1;
          for (let i = yuccaStart[b]; i < yuccaStart[b + 1]; i++) {
            blade(yuccaOrder[i], side);
            // Many overlapping shapes in one fill get slow: fill in batches.
            if (kite && ++m === 150) {
              ctx!.fill();
              ctx!.beginPath();
              m = 0;
            }
          }
        }
        if (kite) ctx!.fill();
        else ctx!.stroke();
      };
      ctx!.lineCap = "butt";
      ctx!.lineWidth = Math.max(0.6, wPx * 0.5);

      // The far side of the ball, a tone darker: over the top of it, it is
      // as much in the sun as the near side.
      for (let t = 0; t < 5; t++) pass(t === 0 ? pal.back[0] : t === 1 ? pal.back[1] : pal.blade[t - 2], t, 0, -1, 0);

      // The trunk: what shows of it under the skirt.
      const t0 = P(x, 0, z);
      const t1 = P(x, grown.trunkTop, z);
      const tdx = t1[0] - t0[0];
      const tdy = t1[1] - t0[1];
      const tdl = Math.hypot(tdx, tdy) || 1;
      const tr = Math.max(0.8, grown.trunkR * sPx);
      const tnx = (-tdy / tdl) * tr;
      const tny = (tdx / tdl) * tr;
      const trunkPath = () => {
        ctx!.beginPath();
        ctx!.moveTo(t0[0] + tnx, t0[1] + tny);
        ctx!.lineTo(t1[0] + tnx, t1[1] + tny);
        ctx!.lineTo(t1[0] - tnx, t1[1] - tny);
        ctx!.lineTo(t0[0] - tnx, t0[1] - tny);
        ctx!.closePath();
      };
      trunkPath();
      ctx!.fillStyle = pal.trunk;
      ctx!.fill();
      const litSide = (tnx * lsx + tny * lsy) / lsl > 0 ? 1 : -1;
      if (tr > 2) {
        ctx!.beginPath();
        ctx!.moveTo(t0[0] + tnx * 0.55 * litSide, t0[1] + tny * 0.55 * litSide);
        ctx!.lineTo(t1[0] + tnx * 0.55 * litSide, t1[1] + tny * 0.55 * litSide);
        ctx!.lineWidth = tr * 0.6;
        ctx!.strokeStyle = pal.trunkLit;
        ctx!.stroke();
      }
      // Close up, the lattice of old leaf bases.
      if (tr > 5) {
        ctx!.save();
        trunkPath();
        ctx!.clip();
        const step = tr * 0.32;
        const reach = tdl + tr * 2;
        ctx!.beginPath();
        for (let s = -tr * 2; s < reach; s += step) {
          const ax = t0[0] + (tdx / tdl) * s;
          const ay = t0[1] + (tdy / tdl) * s;
          ctx!.moveTo(ax - tnx * 1.2, ay - tny * 1.2);
          ctx!.lineTo(ax + tnx * 1.2 + (tdx / tdl) * tr * 0.7, ay + tny * 1.2 + (tdy / tdl) * tr * 0.7);
          ctx!.moveTo(ax + tnx * 1.2, ay + tny * 1.2);
          ctx!.lineTo(ax - tnx * 1.2 + (tdx / tdl) * tr * 0.7, ay - tny * 1.2 + (tdy / tdl) * tr * 0.7);
        }
        ctx!.lineWidth = Math.max(0.7, tr * 0.05);
        ctx!.strokeStyle = pal.trunkLine;
        ctx!.stroke();
        ctx!.restore();
      }

      // The skirt: its outline in straw, the side to the sun paler.
      const skirtHull = (scale: number, shift: number) => {
        const pts: [number, number][] = [];
        for (let i = 0; i < skirt.length; i += 2) {
          const y = skirt[i] - grown.sy;
          const r = skirt[i + 1] * scale;
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const ox = Math.cos(a) * r + -0.44 * shift * skirt[i + 1];
            const oz = Math.sin(a) * r + -0.43 * shift * skirt[i + 1];
            pts.push([S[9] + S[0] * ox + S[1] * y + S[2] * oz, S[10] + S[3] * ox + S[4] * y + S[5] * oz]);
          }
        }
        const hull = convexHull(pts);
        ctx!.beginPath();
        hull.forEach(([px, py], i) => (i ? ctx!.lineTo(px, py) : ctx!.moveTo(px, py)));
        ctx!.closePath();
      };
      skirtHull(1, 0);
      ctx!.fillStyle = pal.skirt;
      ctx!.fill();
      skirtHull(0.78, 0.3);
      ctx!.fillStyle = pal.skirtLit;
      ctx!.fill();
      // Close up, the hanging leaves themselves.
      if (grown.strawLen * sPx >= 3) {
        ctx!.lineWidth = Math.max(0.6, 0.018 * (rw / BY_R) * sPx);
        for (let t = 0; t < 3; t++) {
          ctx!.beginPath();
          for (let o = 0; o < straw.length; o += 8) {
            if (straw[o + 6] !== t) continue;
            if (S[6] * straw[o] + S[8] * straw[o + 2] > 0) continue;
            const ax = S[9] + S[0] * straw[o] + S[1] * straw[o + 1] + S[2] * straw[o + 2];
            const ay = S[10] + S[3] * straw[o] + S[4] * straw[o + 1] + S[5] * straw[o + 2];
            const bx = S[9] + S[0] * straw[o + 3] + S[1] * straw[o + 4] + S[2] * straw[o + 5];
            const by = S[10] + S[3] * straw[o + 3] + S[4] * straw[o + 4] + S[5] * straw[o + 5];
            const c = straw[o + 7];
            ctx!.moveTo(ax, ay);
            ctx!.quadraticCurveTo((ax + bx) / 2 - (by - ay) * c, (ay + by) / 2 + (bx - ax) * c, bx, by);
          }
          ctx!.strokeStyle = pal.straw[t];
          ctx!.stroke();
        }
        ctx!.lineWidth = Math.max(0.6, wPx * 0.5);
      }

      // The ball's dark heart, so gaps between near blades read as depth.
      ctx!.beginPath();
      ctx!.arc(G[9], G[10], Math.max(1, grown.coreR * gPx), 0, Math.PI * 2);
      ctx!.fillStyle = pal.core;
      ctx!.fill();

      // The near blades, toward the sun lighter, a band at a time far to
      // near so the tones lie among each other; each blade's shaded half a
      // tone darker than its sunny one. Close up each one's shaded edge is
      // drawn in, or where they crowd — the fan up from the crown — they
      // melt into one sheet.
      for (let band = 1; band <= 4; band++) {
        const b0 = band * 5;
        for (let t = 0; t < 5; t++) {
          // a stroke far off: a tone down, as its shaded half and edge are
          if (!kite) pass(t ? pal.blade[t - 1] : pal.back[1], b0 + t, 0, -1, 0);
          else pass(pal.blade[t], b0 + t, t === 0 ? 0 : 1, t < 4 ? b0 + t + 1 : -1, -1);
        }
        if (wPx < 3) continue;
        ctx!.beginPath();
        for (let i = yuccaStart[b0]; i < yuccaStart[b0 + 5]; i++) {
          const k = yuccaOrder[i];
          const ux = ytx[k] - ybx[k];
          const uy = yty[k] - yby[k];
          const ul = Math.hypot(ux, uy) || 1;
          const half = wPx * 0.36 * Math.sqrt(Math.min(1, ul / bladePx));
          let nx = (-uy / ul) * half;
          let ny = (ux / ul) * half;
          if (nx * lsx + ny * lsy > 0) {
            nx = -nx;
            ny = -ny;
          }
          ctx!.moveTo(ybx[k] + ux * 0.35 + nx, yby[k] + uy * 0.35 + ny);
          ctx!.lineTo(ytx[k], yty[k]);
        }
        ctx!.lineWidth = Math.max(0.6, wPx * 0.1);
        ctx!.strokeStyle = pal.edge;
        ctx!.stroke();
      }
    }

    // Golden Barrel's profile, from the app's scan: radius (1 = the plant's
    // half-spread) at heights up it (1 = its height). A drum to half way,
    // then the dome closing in to the crown.
    const GB_PROFILE: [number, number][] = [
      [0, 0.86],
      [0.12, 0.92],
      [0.26, 0.94],
      [0.4, 0.93],
      [0.52, 0.89],
      [0.63, 0.82],
      [0.73, 0.73],
      [0.82, 0.6],
      [0.9, 0.42],
      [0.96, 0.22],
    ];
    const GB_RIBS = 27;
    type BarrelPlant = {
      /** ridge and groove points, per rib per station, xyz offsets from the
       *  plant's foot, feet: ridge k at [k][i], groove after it at [k][i] */
      ridge: Float32Array;
      groove: Float32Array;
      /** the flank faces: rib, which side, lower and upper station, then
       *  the face's normal xyz and how lit it is 0–1 */
      faces: Float32Array;
      /** areoles: xyz, normal xyz, then spines' tips, 7 × xyz */
      areoles: Float32Array;
      /** spine reach, feet */
      spine: number;
      /** areole spacing up a rib, feet */
      step: number;
    };
    const barrelGrown = new Map<string, BarrelPlant>();
    const GB_ST = GB_PROFILE.length;
    // Scratch: one plant's projected ridges and grooves, its faces' depths.
    const gbRx = new Float32Array(GB_RIBS * GB_ST);
    const gbRy = new Float32Array(GB_RIBS * GB_ST);
    const gbGx = new Float32Array(GB_RIBS * GB_ST);
    const gbGy = new Float32Array(GB_RIBS * GB_ST);
    const gbDepth = new Float32Array(GB_RIBS * 2 * 3);
    const gbOrder = new Int16Array(GB_RIBS * 2 * 3);

    function growGoldenBarrel(h: number, rw: number, rot: number, seed: string): BarrelPlant {
      const rng = rngFor("goldenbarrel:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const ridge = new Float32Array(GB_RIBS * GB_ST * 3);
      const groove = new Float32Array(GB_RIBS * GB_ST * 3);
      // Rib depth: the grooves sit a seventh in from the ridges.
      for (let k = 0; k < GB_RIBS; k++) {
        const a = rot + ((k + (rng() - 0.5) * 0.15) / GB_RIBS) * Math.PI * 2;
        const g = rot + ((k + 0.5) / GB_RIBS) * Math.PI * 2;
        for (let i = 0; i < GB_ST; i++) {
          const [y, r] = GB_PROFILE[i];
          const o = (k * GB_ST + i) * 3;
          ridge[o] = Math.cos(a) * r * rw;
          ridge[o + 1] = y * h;
          ridge[o + 2] = Math.sin(a) * r * rw;
          const rg = r * (1 - 0.14 * Math.min(1, (1 - y) * 2.5));
          groove[o] = Math.cos(g) * rg * rw;
          groove[o + 1] = y * h;
          groove[o + 2] = Math.sin(g) * rg * rw;
        }
      }
      // Faces: each rib's two flanks (side 0 toward the groove after it, 1
      // toward the one before), in three pieces up the plant.
      const SEG = [0, 3, 6, GB_ST - 1];
      const faces: number[] = [];
      for (let k = 0; k < GB_RIBS; k++) {
        const kp = (k + GB_RIBS - 1) % GB_RIBS;
        for (let side = 0; side < 2; side++) {
          for (let s = 0; s < 3; s++) {
            const i0 = SEG[s];
            const i1 = SEG[s + 1];
            const im = (i0 + i1) >> 1;
            const R = (i: number) => (k * GB_ST + i) * 3;
            const Gq = (i: number) => ((side ? kp : k) * GB_ST + i) * 3;
            // up the ridge, and across from the ridge to the groove
            const tx = ridge[R(i1)] - ridge[R(i0)];
            const ty = ridge[R(i1) + 1] - ridge[R(i0) + 1];
            const tz = ridge[R(i1) + 2] - ridge[R(i0) + 2];
            const cx = groove[Gq(im)] - ridge[R(im)];
            const cy = groove[Gq(im) + 1] - ridge[R(im) + 1];
            const cz = groove[Gq(im) + 2] - ridge[R(im) + 2];
            let nx = ty * cz - tz * cy;
            let ny = tz * cx - tx * cz;
            let nz = tx * cy - ty * cx;
            // outward
            if (nx * ridge[R(im)] + nz * ridge[R(im) + 2] + ny * (ridge[R(im) + 1] - h * 0.3) < 0) {
              nx = -nx;
              ny = -ny;
              nz = -nz;
            }
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl;
            ny /= nl;
            nz /= nl;
            const lit = Math.max(0, Math.min(1, 0.5 + 0.5 * (nx * LX + ny * LY + nz * LZ)));
            faces.push(k, side, i0, i1, nx, ny, nz, lit);
          }
        }
      }
      // Areoles up every ridge, each a tuft of seven spines lying out over
      // the body, curving a little off it.
      const spine = rw * 0.17;
      const N = 13;
      const step = (h * 0.9) / N;
      const ar: number[] = [];
      for (let k = 0; k < GB_RIBS; k++) {
        for (let j = 0; j < N; j++) {
          const u = 0.05 + (0.9 * (j + 0.5 + (rng() - 0.5) * 0.3)) / N;
          // along the ridge by height
          let i = 0;
          while (i < GB_ST - 2 && GB_PROFILE[i + 1][0] < u) i++;
          const f = (u - GB_PROFILE[i][0]) / (GB_PROFILE[i + 1][0] - GB_PROFILE[i][0]);
          const o0 = (k * GB_ST + i) * 3;
          const o1 = o0 + 3;
          const px = ridge[o0] + (ridge[o1] - ridge[o0]) * f;
          const py = ridge[o0 + 1] + (ridge[o1 + 1] - ridge[o0 + 1]) * f;
          const pz = ridge[o0 + 2] + (ridge[o1 + 2] - ridge[o0 + 2]) * f;
          // the surface's frame there: out, up the rib, across it
          let ux = ridge[o1] - ridge[o0];
          let uy = ridge[o1 + 1] - ridge[o0 + 1];
          let uz = ridge[o1 + 2] - ridge[o0 + 2];
          const ul = Math.hypot(ux, uy, uz) || 1;
          ux /= ul;
          uy /= ul;
          uz /= ul;
          const rl = Math.hypot(px, pz) || 1;
          let ax = -pz / rl;
          const ay = 0;
          let az = px / rl;
          let nx = ay * uz - az * uy;
          let ny = az * ux - ax * uz;
          let nz = ax * uy - ay * ux;
          if (nx * px + nz * pz < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
            ax = -ax;
            az = -az;
          }
          ar.push(px, py, pz, nx, ny, nz);
          for (let s = 0; s < 7; s++) {
            const b = ((s + rng() * 0.6) / 7) * Math.PI * 2;
            const len = spine * (0.6 + 0.5 * rng()) * (s === 0 ? 1.3 : 1);
            const cb = Math.cos(b);
            const sb = Math.sin(b);
            ar.push(
              px + (ux * cb + ax * sb + nx * 0.35) * len,
              py + (uy * cb + ay * sb + ny * 0.35) * len,
              pz + (uz * cb + az * sb + nz * 0.35) * len,
            );
          }
        }
      }
      return { ridge, groove, faces: new Float32Array(faces), areoles: new Float32Array(ar), spine, step };
    }

    const mixRgb = (a: number[], b: number[], t: number) =>
      `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

    /** Golden Barrel, after the app's scan: a squat drum twice as wide as
     *  it is tall, doming to a crown of cream wool.
     *
     *  Twenty-seven ribs, each two flanks lit by their own lean, the near
     *  ones only, far to near; dark grooves between. Far off its spines are
     *  what you see, so the flanks are gold and the ridges paler; nearer the
     *  dark green body shows through and the spines are drawn — a tuft at
     *  every areole up every ridge, lying out over the grooves. All through
     *  a local map at the plant. Grown once and cached.
     */
    function drawGoldenBarrelBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = barrelGrown.get(key);
      if (!grown) {
        if (barrelGrown.size > 400) barrelGrown.clear(); // growth and edits mint new keys
        grown = growGoldenBarrel(h, rw, rot, seed);
        barrelGrown.set(key, grown);
      }
      const pal = sel ? GOLDEN_BARREL_GOLD : GOLDEN_BARREL_COLOURS;
      const { ridge, groove, faces, areoles } = grown;
      const J = localMap(x, 0, z);
      const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]), Math.hypot(J[1], J[4]));
      const stepPx = grown.step * footPx;
      // How much of the green body shows between the spines: none far off,
      // all of it once the spines are drawn.
      const near = Math.max(0, Math.min(1, (stepPx - 2) / 4));
      const tones = [0, 1, 2, 3, 4].map((t) => mixRgb(pal.far[t], pal.body[t], near));
      // toward the camera
      const el = Math.hypot(J[6], J[7], J[8]) || 1;
      const ex = -J[6] / el;
      const ey = -J[7] / el;
      const ez = -J[8] / el;

      for (let o = 0, n = 0; o < ridge.length; o += 3, n++) {
        gbRx[n] = J[9] + J[0] * ridge[o] + J[1] * ridge[o + 1] + J[2] * ridge[o + 2];
        gbRy[n] = J[10] + J[3] * ridge[o] + J[4] * ridge[o + 1] + J[5] * ridge[o + 2];
        gbGx[n] = J[9] + J[0] * groove[o] + J[1] * groove[o + 1] + J[2] * groove[o + 2];
        gbGy[n] = J[10] + J[3] * groove[o] + J[4] * groove[o + 1] + J[5] * groove[o + 2];
      }
      // The near faces, far to near.
      let nf = 0;
      for (let f = 0, o = 0; o < faces.length; f++, o += 8) {
        if (faces[o + 4] * ex + faces[o + 5] * ey + faces[o + 6] * ez <= 0) continue;
        const k = faces[o];
        const im = (faces[o + 2] + faces[o + 3]) >> 1;
        const r = (k * GB_ST + im) * 3;
        gbDepth[f] = J[6] * ridge[r] + J[7] * ridge[r + 1] + J[8] * ridge[r + 2];
        gbOrder[nf++] = f;
      }
      const order = gbOrder.subarray(0, nf);
      order.sort((a, b) => gbDepth[b] - gbDepth[a]);
      ctx!.lineJoin = "round";
      for (const f of order) {
        const o = f * 8;
        const k = faces[o];
        const g = faces[o + 1] ? (k + GB_RIBS - 1) % GB_RIBS : k;
        const i0 = faces[o + 2];
        const i1 = faces[o + 3];
        ctx!.beginPath();
        for (let i = i0; i <= i1; i++) {
          const n = k * GB_ST + i;
          if (i === i0) ctx!.moveTo(gbRx[n], gbRy[n]);
          else ctx!.lineTo(gbRx[n], gbRy[n]);
        }
        // the top piece closes on the crown
        for (let i = i1; i >= i0; i--) ctx!.lineTo(gbGx[g * GB_ST + i], gbGy[g * GB_ST + i]);
        ctx!.closePath();
        ctx!.fillStyle = tones[Math.min(4, Math.floor(faces[o + 7] * 5))];
        ctx!.fill();
        // seal the hairline between neighbouring faces
        ctx!.strokeStyle = ctx!.fillStyle;
        ctx!.lineWidth = 0.6;
        ctx!.stroke();
      }

      // Grooves dark, ridges pale (the rows of spines), on the near side.
      const facing = (k: number, i: number) => {
        const o = (k * GB_ST + i) * 3;
        const rl = Math.hypot(ridge[o], ridge[o + 2]) || 1;
        return (ridge[o] / rl) * ex + (ridge[o + 2] / rl) * ez + 0.4 * ey > -0.05;
      };
      const line = (pts: "ridge" | "groove") => {
        ctx!.beginPath();
        for (let k = 0; k < GB_RIBS; k++) {
          let on = false;
          for (let i = 0; i < GB_ST; i++) {
            const n = k * GB_ST + i;
            if (!facing(k, i)) {
              on = false;
              continue;
            }
            const px = pts === "ridge" ? gbRx[n] : gbGx[n];
            const py = pts === "ridge" ? gbRy[n] : gbGy[n];
            if (on) ctx!.lineTo(px, py);
            else ctx!.moveTo(px, py);
            on = true;
          }
        }
      };
      ctx!.lineCap = "round";
      line("groove");
      ctx!.lineWidth = Math.max(0.6, rw * 0.025 * footPx);
      ctx!.strokeStyle = pal.groove;
      ctx!.stroke();
      if (near < 1) {
        line("ridge");
        ctx!.lineWidth = Math.max(0.6, rw * 0.03 * footPx);
        ctx!.strokeStyle = pal.ridge;
        ctx!.globalAlpha = (1 - near) * 0.55;
        ctx!.stroke();
        ctx!.globalAlpha = 1;
      }

      // The crown: a ragged cushion of cream wool, paler where it is newest,
      // under the top tufts' spines.
      const cap = (y: number, r: number) => {
        ctx!.beginPath();
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          const rr = r * rw * (1 + 0.09 * Math.sin(a * 5 + rot * 3) + (i % 2 ? 0.1 : -0.06));
          const px = Math.cos(a) * rr;
          const pz = Math.sin(a) * rr;
          const sx = J[9] + J[0] * px + J[1] * y * h + J[2] * pz;
          const sy = J[10] + J[3] * px + J[4] * y * h + J[5] * pz;
          if (i) ctx!.lineTo(sx, sy);
          else ctx!.moveTo(sx, sy);
        }
        ctx!.closePath();
      };
      cap(0.93, 0.34);
      ctx!.fillStyle = pal.crown;
      ctx!.fill();
      cap(0.985, 0.12);
      ctx!.fillStyle = pal.crownHeart;
      ctx!.fill();
      // Close up, the spines: a tuft at every areole on the near side.
      if (stepPx >= 2) {
        const A = 6 + 21;
        for (let lit = 0; lit < 2; lit++) {
          ctx!.beginPath();
          for (let o = 0; o < areoles.length; o += A) {
            const nx = areoles[o + 3];
            const ny = areoles[o + 4];
            const nz = areoles[o + 5];
            if (nx * ex + ny * ey + nz * ez <= 0.05) continue;
            if ((nx * -0.44 + ny * 0.79 + nz * -0.43 > 0.15 ? 1 : 0) !== lit) continue;
            const ax = J[9] + J[0] * areoles[o] + J[1] * areoles[o + 1] + J[2] * areoles[o + 2];
            const ay = J[10] + J[3] * areoles[o] + J[4] * areoles[o + 1] + J[5] * areoles[o + 2];
            for (let s = 0; s < 7; s++) {
              const q = o + 6 + s * 3;
              ctx!.moveTo(ax, ay);
              ctx!.lineTo(J[9] + J[0] * areoles[q] + J[1] * areoles[q + 1] + J[2] * areoles[q + 2], J[10] + J[3] * areoles[q] + J[4] * areoles[q + 1] + J[5] * areoles[q + 2]);
            }
          }
          ctx!.lineWidth = Math.max(0.5, grown.spine * footPx * 0.065);
          ctx!.strokeStyle = lit ? pal.spineLit : pal.spine;
          ctx!.stroke();
        }
        // the woolly areoles themselves
        const wr = Math.max(0.6, grown.step * footPx * 0.16);
        ctx!.beginPath();
        for (let o = 0; o < areoles.length; o += A) {
          if (areoles[o + 3] * ex + areoles[o + 4] * ey + areoles[o + 5] * ez <= 0.05) continue;
          const ax = J[9] + J[0] * areoles[o] + J[1] * areoles[o + 1] + J[2] * areoles[o + 2];
          const ay = J[10] + J[3] * areoles[o] + J[4] * areoles[o + 1] + J[5] * areoles[o + 2];
          ctx!.moveTo(ax + wr, ay);
          ctx!.arc(ax, ay, wr, 0, Math.PI * 2);
        }
        ctx!.fillStyle = pal.wool;
        ctx!.fill();
      }

      ctx!.lineCap = "butt";
      ctx!.lineJoin = "miter";
    }

    /** AZ Boulder 1: the scanned rock itself.
     *
     *  The boulder body below is a jittered solid, a fair stand-in for a
     *  rock nobody has scanned. This one has been: a low granite slab a
     *  fifth as tall as it is long, with a step across its top where a layer
     *  broke away, and chipped corners. So its body is the scan, cut down to
     *  199 faces. It is the same rock at every placement, as it is in the
     *  headset, lit face by face under the sheet's light.
     */
    // x along its length (-0.5 to 0.5), y up, z across, in lengths of the
    // rock; three vertices to a face, wound outward.
    const AZR_V = [
      0.5, 0.042, -0.062, 0.431, 0.004, -0.203, 0.417, 0.003, 0.065, 0.415, 0.086, 0.027, 0.324,
      0.102, 0.054, 0.286, 0.14, 0.038, 0.319, 0.003, 0.154, -0.326, 0.036, 0.32, -0.061, 0.005,
      0.339, -0.033, 0.102, 0.273, -0.041, 0.004, 0.303, 0.033, 0.179, -0.09, 0.13, 0.004, 0.216,
      -0.498, 0.004, 0.245, -0.4, 0.003, 0.307, -0.398, 0.049, 0.326, 0.43, 0.072, -0.066, -0.367,
      0.15, 0.295, 0.071, 0.004, 0.253, 0.122, 0.088, 0.164, 0.004, 0.003, 0.279, 0.049, 0.065,
      0.221, -0.251, 0.003, -0.118, -0.413, 0.002, 0.14, -0.41, 0.152, 0.125, 0.024, 0.171, -0.308,
      -0.088, 0.18, -0.28, 0.287, 0.118, -0.218, 0.206, 0.143, -0.181, -0.041, 0.208, -0.169,
      -0.078, 0.21, -0.225, -0.127, 0.204, -0.147, -0.26, 0.068, -0.039, 0.191, 0.15, -0.093, 0.152,
      0.137, -0.077, 0.123, 0.161, -0.245, 0.487, 0.006, 0.04, 0.49, 0.052, 0.015, -0.007, 0.103,
      0.229, 0.252, 0.061, 0.141, 0.24, 0.004, 0.181, 0.183, 0.004, 0.204, -0.17, 0.076, -0.197,
      -0.251, 0.169, -0.198, -0.24, 0.142, -0.098, -0.252, 0.054, -0.119, -0.235, 0.109, -0.191,
      -0.217, 0.193, -0.25, -0.137, 0.14, -0.243, -0.16, 0.194, -0.265, -0.309, 0.071, 0.284,
      -0.211, 0.142, 0.283, -0.273, 0.142, 0.27, -0.243, 0.151, -0.038, 0.204, 0.128, 0.102, 0.054,
      0.179, 0.03, -0.205, 0.213, -0.05, 0.497, 0.042, -0.134, -0.442, 0.12, 0.277, 0.318, 0.003,
      0.098, -0.331, 0.066, 0.047, -0.315, 0.003, 0.021, -0.312, 0.008, 0.019, -0.275, 0.005, 0.307,
      -0.203, 0.213, -0.173, -0.222, 0.089, 0.31, -0.182, 0.123, 0.324, -0.458, 0.044, 0.186, 0.212,
      0.118, -0.019, -0.247, 0.058, 0.3, 0.268, 0.047, -0.373, 0.263, 0.004, -0.349, 0.266, 0.103,
      0.09, 0.338, 0.074, -0.328, 0.286, 0.086, -0.375, -0.053, 0.204, -0.076, 0.36, 0.003, -0.228,
      -0.488, 0.096, 0.221, -0.44, 0, 0.21, -0.024, 0.075, -0.257, 0.319, 0.107, -0.075, 0.17,
      0.127, -0.344, 0.107, 0.153, -0.32, 0.198, 0.003, -0.328, -0.362, 0.147, 0.062, -0.5, 0.057,
      0.258, -0.462, 0.152, 0.188, -0.281, 0.148, 0.164, 0.193, 0.134, -0.286, -0.12, 0.118, 0.317,
      -0.163, 0.043, 0.373, -0.174, 0.071, 0.329, -0.07, 0.004, -0.205, 0.055, 0.181, -0.191,
      -0.221, 0.149, 0.061, 0.056, 0.003, -0.26, 0.052, 0.094, -0.29, 0.274, 0.105, -0.301, 0.376,
      0.067, -0.291, 0.391, 0.08, -0.182, 0.427, 0.059, -0.226, -0.114, 0.208, 0.008, 0.077, 0.172,
      0.132, -0.192, 0.141, 0.206, -0.093, 0.143, 0.28, -0.073, 0.189, 0.188, -0.196, 0.203, 0.065,
      -0.022, 0.195, 0.101, -0.15, 0.194, 0.18, 0.47, 0.002, -0.158, 0.341, 0.002, -0.276, -0.355,
      0.003, 0.071, -0.219, 0.004, -0.13, -0.274, 0.003, -0.022, -0.149, 0.002, 0.375,
    ];
    const AZR_F = [
      62, 61, 111, 14, 15, 13, 60, 61, 111, 62, 113, 61, 73, 110, 71, 0, 109, 57, 100, 109, 1, 83,
      70, 71, 0, 36, 109, 58, 85, 15, 15, 17, 58, 86, 58, 17, 85, 67, 13, 85, 58, 77, 85, 77, 67, 4,
      6, 59, 5, 4, 3, 80, 5, 3, 2, 3, 4, 4, 59, 2, 82, 81, 96, 83, 96, 81, 102, 19, 54, 107, 105,
      102, 63, 7, 14, 63, 50, 7, 63, 69, 50, 22, 113, 45, 80, 16, 99, 112, 22, 45, 101, 56, 106,
      102, 55, 107, 108, 105, 107, 19, 102, 21, 102, 105, 38, 80, 28, 33, 27, 80, 99, 38, 104, 9,
      104, 38, 105, 28, 80, 27, 101, 108, 107, 51, 66, 104, 103, 104, 108, 21, 102, 38, 79, 48, 26,
      78, 67, 23, 110, 98, 76, 45, 32, 44, 75, 11, 29, 56, 75, 31, 29, 31, 75, 70, 74, 73, 107, 55,
      101, 98, 110, 73, 73, 71, 70, 37, 3, 36, 17, 50, 52, 52, 87, 17, 8, 9, 89, 38, 9, 10, 89, 9,
      104, 101, 106, 108, 94, 103, 106, 106, 103, 108, 104, 105, 108, 104, 103, 51, 19, 12, 41, 77,
      58, 86, 79, 25, 96, 26, 25, 79, 4, 39, 6, 4, 72, 39, 4, 5, 72, 68, 54, 72, 56, 101, 75, 17,
      24, 86, 24, 17, 87, 99, 57, 100, 57, 109, 100, 66, 65, 69, 73, 97, 98, 0, 37, 36, 68, 72, 5,
      68, 5, 33, 5, 80, 33, 98, 99, 100, 34, 68, 33, 78, 67, 13, 3, 2, 36, 91, 66, 69, 65, 66, 51,
      70, 83, 81, 64, 47, 43, 47, 64, 49, 53, 60, 84, 53, 32, 60, 60, 32, 113, 62, 60, 113, 16, 57,
      99, 98, 100, 76, 76, 100, 1, 97, 27, 98, 98, 27, 99, 62, 61, 60, 83, 95, 96, 55, 75, 101, 55,
      11, 75, 82, 35, 88, 12, 19, 21, 111, 23, 60, 64, 44, 56, 44, 53, 56, 15, 85, 13, 53, 106, 56,
      106, 53, 94, 90, 114, 8, 25, 82, 96, 95, 79, 96, 16, 37, 0, 16, 0, 57, 39, 72, 54, 55, 102,
      54, 44, 32, 53, 25, 35, 82, 81, 74, 70, 88, 97, 81, 97, 74, 81, 74, 97, 73, 65, 51, 52, 69,
      52, 50, 69, 65, 52, 16, 80, 3, 37, 16, 3, 15, 7, 50, 14, 7, 15, 15, 50, 17, 10, 20, 38, 88,
      35, 28, 21, 20, 18, 12, 21, 18, 20, 21, 38, 91, 89, 66, 8, 89, 90, 66, 89, 104, 91, 90, 89,
      51, 103, 52, 94, 87, 103, 53, 84, 94, 8, 10, 9, 48, 79, 92, 49, 64, 31, 34, 11, 55, 68, 34,
      55, 54, 68, 55, 60, 67, 84, 84, 67, 24, 23, 67, 60, 77, 86, 67, 86, 24, 67, 93, 34, 33, 30,
      25, 26, 31, 26, 49, 64, 56, 31, 45, 46, 112, 42, 112, 46, 47, 46, 43, 47, 49, 48, 46, 47, 48,
      30, 26, 31, 49, 26, 48, 87, 84, 24, 103, 87, 52, 94, 84, 87, 11, 93, 29, 42, 46, 48, 44, 64,
      43, 11, 34, 93, 81, 82, 88, 91, 69, 114, 69, 63, 114, 90, 91, 114, 45, 44, 46, 46, 44, 43, 27,
      97, 88, 35, 25, 93, 95, 92, 79, 92, 112, 42, 29, 30, 31, 93, 25, 30, 93, 30, 29, 45, 113, 32,
      39, 41, 40, 40, 6, 39, 92, 42, 48, 54, 41, 39, 54, 19, 41, 93, 28, 35, 28, 93, 33, 28, 27, 88,
    ];
    const AZR_NV = AZR_V.length / 3;
    const AZR_NF = AZR_F.length / 3;
    const AZR_LEVELS = 8;
    const AZR_H = AZR_V.reduce((m, v, i) => (i % 3 === 1 ? Math.max(m, v) : m), 0);
    // Shade to lit, then the same again stained, for each palette.
    const AZR_TONES = [AZ_ROCK_COLOURS, AZ_ROCK_GOLD].map((pal) =>
      [0, 0.35].flatMap((stain) =>
        Array.from({ length: AZR_LEVELS }, (_, i) => {
          const t = i / (AZR_LEVELS - 1);
          const rgb = pal.shade.map((v, k) => {
            const c = v + (pal.lit[k] - v) * t;
            return (c + (pal.stain[k] - c) * stain) | 0;
          });
          return `rgb(${rgb.join(",")})`;
        }),
      ),
    );
    const azrNormal = (f: number) => {
      const a = AZR_F[f * 3] * 3;
      const b = AZR_F[f * 3 + 1] * 3;
      const d = AZR_F[f * 3 + 2] * 3;
      const ux = AZR_V[b] - AZR_V[a];
      const uy = AZR_V[b + 1] - AZR_V[a + 1];
      const uz = AZR_V[b + 2] - AZR_V[a + 2];
      const wx = AZR_V[d] - AZR_V[a];
      const wy = AZR_V[d + 1] - AZR_V[a + 1];
      const wz = AZR_V[d + 2] - AZR_V[a + 2];
      return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    };
    // Where the stone breaks: edges whose faces meet at more than 40 degrees,
    // the step and the chipped corners, as (vertex, vertex, face, face).
    const AZR_CREASES: number[] = (() => {
      const sides = new Map<number, number[]>();
      for (let f = 0; f < AZR_NF; f++) {
        for (let k = 0; k < 3; k++) {
          const a = AZR_F[f * 3 + k];
          const b = AZR_F[f * 3 + ((k + 1) % 3)];
          const key = Math.min(a, b) * 256 + Math.max(a, b);
          const fs = sides.get(key);
          if (fs) fs.push(f);
          else sides.set(key, [f]);
        }
      }
      const out: number[] = [];
      const cos40 = Math.cos((40 * Math.PI) / 180);
      for (const [key, fs] of sides) {
        if (fs.length !== 2) continue;
        const p = azrNormal(fs[0]);
        const q = azrNormal(fs[1]);
        const c = (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / (Math.hypot(...p) * Math.hypot(...q) || 1);
        if (c < cos40) out.push(key >> 8, key & 255, fs[0], fs[1]);
      }
      return out;
    })();
    // The granite's grain, scattered by area over its faces: each fleck's
    // face, place in the rock's own measure, size, and whether it's light.
    // Few and the same size, they read as polka dots; this is grit.
    const AZR_FLECKS = 900;
    const azrFleckFace = new Uint16Array(AZR_FLECKS);
    const azrFleckAt = new Float32Array(AZR_FLECKS * 3);
    const azrFleckSize = new Float32Array(AZR_FLECKS);
    const azrFleckLight = new Uint8Array(AZR_FLECKS);
    {
      const rng = rngFor("az-boulder");
      const upTo: number[] = [];
      let total = 0;
      for (let f = 0; f < AZR_NF; f++) upTo.push((total += Math.hypot(...azrNormal(f)) / 2));
      for (let i = 0; i < AZR_FLECKS; i++) {
        const pick = rng() * total;
        let f = 0;
        while (f < AZR_NF - 1 && upTo[f] < pick) f++;
        const r1 = Math.sqrt(rng());
        const r2 = rng();
        const wa = 1 - r1;
        const wb = r1 * (1 - r2);
        const wd = r1 * r2;
        for (let k = 0; k < 3; k++) {
          azrFleckAt[i * 3 + k] =
            AZR_V[AZR_F[f * 3] * 3 + k] * wa + AZR_V[AZR_F[f * 3 + 1] * 3 + k] * wb + AZR_V[AZR_F[f * 3 + 2] * 3 + k] * wd;
        }
        azrFleckFace[i] = f;
        azrFleckSize[i] = 0.5 + rng() * rng() * 1.5;
        azrFleckLight[i] = rng() < 0.55 ? 1 : 0;
      }
    }

    type AzRock = {
      /** the vertices on the ground, and each face's outward normal and
       *  centre, in feet */
      v: Float32Array;
      n: Float32Array;
      c: Float32Array;
      /** each face's tone, plus AZR_LEVELS when stained */
      band: Uint8Array;
      /** the flecks on the ground */
      fl: Float32Array;
    };
    const azRockGrown = new Map<string, AzRock>();
    // Scratch, reused rock to rock: projected vertices, which faces show,
    // and their depths.
    const azrScreen = new Float32Array(AZR_NV * 3);
    const azrSeen = new Uint8Array(AZR_NF);
    const azrDepth = new Float32Array(AZR_NF);
    const azrOrder: number[] = [];

    function growAzRock(x: number, z: number, len: number, rot: number): AzRock {
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const put = (src: ArrayLike<number>, i: number, out: Float32Array) => {
        const mx = src[i * 3];
        const mz = src[i * 3 + 2];
        out[i * 3] = x + (mx * cr - mz * sr) * len;
        out[i * 3 + 1] = src[i * 3 + 1] * len;
        out[i * 3 + 2] = z + (mx * sr + mz * cr) * len;
      };
      const v = new Float32Array(AZR_NV * 3);
      for (let i = 0; i < AZR_NV; i++) put(AZR_V, i, v);
      const n = new Float32Array(AZR_NF * 3);
      const c = new Float32Array(AZR_NF * 3);
      const band = new Uint8Array(AZR_NF);
      for (let f = 0; f < AZR_NF; f++) {
        const [mx, my, mz] = azrNormal(f);
        const L = Math.hypot(mx, my, mz) || 1;
        const nx = (mx * cr - mz * sr) / L;
        const ny = my / L;
        const nz = (mx * sr + mz * cr) / L;
        n[f * 3] = nx;
        n[f * 3 + 1] = ny;
        n[f * 3 + 2] = nz;
        for (let k = 0; k < 3; k++) {
          c[f * 3 + k] = (v[AZR_F[f * 3] * 3 + k] + v[AZR_F[f * 3 + 1] * 3 + k] + v[AZR_F[f * 3 + 2] * 3 + k]) / 3;
        }
        // Wrapped light, so the shaded sides still turn.
        const lit = Math.pow(0.5 + 0.5 * (nx * LX + ny * LY + nz * LZ), 1.5);
        const tone = Math.max(0, Math.min(AZR_LEVELS - 1, Math.round(lit * (AZR_LEVELS - 1))));
        // A side low down, where the rock sat in the soil, is stained.
        const stained = c[f * 3 + 1] < 0.3 * AZR_H * len && Math.abs(ny) < 0.6;
        band[f] = tone + (stained ? AZR_LEVELS : 0);
      }
      const fl = new Float32Array(AZR_FLECKS * 3);
      for (let i = 0; i < AZR_FLECKS; i++) put(azrFleckAt, i, fl);
      return { v, n, c, band, fl };
    }

    function drawAzBoulderBody(x: number, z: number, rw: number, rot: number, sel: boolean, lw: number) {
      // The plan mark's radius is half the rock's length.
      const len = rw * 2;
      const key = `${x}|${z}|${len}|${rot}`;
      let rock = azRockGrown.get(key);
      if (!rock) {
        if (azRockGrown.size > 400) azRockGrown.clear(); // edits mint new keys
        rock = growAzRock(x, z, len, rot);
        azRockGrown.set(key, rock);
      }
      const { v, n, c, band, fl } = rock;
      const pal = sel ? AZ_ROCK_GOLD : AZ_ROCK_COLOURS;
      const tones = AZR_TONES[sel ? 1 : 0];

      for (let i = 0; i < AZR_NV; i++) {
        const q = P(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
        azrScreen[i * 3] = q[0];
        azrScreen[i * 3 + 1] = q[1];
        azrScreen[i * 3 + 2] = q[2];
      }
      azrOrder.length = 0;
      for (let f = 0; f < AZR_NF; f++) {
        const seen =
          n[f * 3] * (eye[0] - c[f * 3]) + n[f * 3 + 1] * (eye[1] - c[f * 3 + 1]) + n[f * 3 + 2] * (eye[2] - c[f * 3 + 2]);
        azrSeen[f] = seen > 0 ? 1 : 0;
        if (seen <= 0) continue;
        azrDepth[f] =
          azrScreen[AZR_F[f * 3] * 3 + 2] + azrScreen[AZR_F[f * 3 + 1] * 3 + 2] + azrScreen[AZR_F[f * 3 + 2] * 3 + 2];
        azrOrder.push(f);
      }
      if (!azrOrder.length) return;
      azrOrder.sort((a, b) => azrDepth[b] - azrDepth[a]);
      const tri = (f: number) => {
        const a = AZR_F[f * 3] * 3;
        const b = AZR_F[f * 3 + 1] * 3;
        const d = AZR_F[f * 3 + 2] * 3;
        ctx!.moveTo(azrScreen[a], azrScreen[a + 1]);
        ctx!.lineTo(azrScreen[b], azrScreen[b + 1]);
        ctx!.lineTo(azrScreen[d], azrScreen[d + 1]);
        ctx!.closePath();
      };

      // The whole rock first: its outline, then stone under the faces so no
      // sand shows in the seams between them. The outline is stroked at
      // twice the weight it shows at, and the faces cover its inner half, so
      // only the rock's edge keeps it. Edges between a face that shows and
      // one that doesn't outlined every little fold inside it as well.
      ctx!.beginPath();
      for (const f of azrOrder) tri(f);
      ctx!.lineJoin = "round";
      ctx!.strokeStyle = pal.edge;
      ctx!.lineWidth = lw * 1.6;
      ctx!.stroke();
      ctx!.fillStyle = tones[3];
      ctx!.fill();
      // The faces, far to near, one fill to each run of a tone.
      let cur = -1;
      ctx!.beginPath();
      for (const f of azrOrder) {
        if (band[f] !== cur) {
          if (cur >= 0) {
            ctx!.fillStyle = tones[cur];
            ctx!.fill();
            ctx!.beginPath();
          }
          cur = band[f];
        }
        tri(f);
      }
      ctx!.fillStyle = tones[cur];
      ctx!.fill();

      const sizePx = ftPx(x, z, len);
      if (sizePx > 14) {
        ctx!.beginPath();
        for (let e = 0; e < AZR_CREASES.length; e += 4) {
          if (!azrSeen[AZR_CREASES[e + 2]] || !azrSeen[AZR_CREASES[e + 3]]) continue;
          const a = AZR_CREASES[e] * 3;
          const b = AZR_CREASES[e + 1] * 3;
          ctx!.moveTo(azrScreen[a], azrScreen[a + 1]);
          ctx!.lineTo(azrScreen[b], azrScreen[b + 1]);
        }
        ctx!.strokeStyle = pal.crease;
        ctx!.lineWidth = lw * 0.6;
        ctx!.stroke();
      }
      // Close up, the granite's grain: dark flecks and light ones, never
      // more than a couple of pixels however near the camera comes.
      if (sizePx > 60) {
        const s0 = Math.min(Math.max(ftPx(x, z, 0.016), 0.7), 2.2);
        for (const light of [0, 1]) {
          ctx!.beginPath();
          for (let i = 0; i < AZR_FLECKS; i++) {
            if (azrFleckLight[i] !== light || !azrSeen[azrFleckFace[i]]) continue;
            const q = P(fl[i * 3], fl[i * 3 + 1], fl[i * 3 + 2]);
            const s = s0 * azrFleckSize[i];
            ctx!.rect(q[0] - s / 2, q[1] - s / 2, s, s);
          }
          ctx!.fillStyle = light ? pal.light : pal.dark;
          ctx!.fill();
        }
      }
      ctx!.lineWidth = lw;
    }

    /** A boulder: a real faceted solid, lit.
     *
     *  It drew at a hardcoded 1.2 ft whatever the rock — an AZ Boulder is
     *  3.4 ft across in the headset and came out at a third of that, with a
     *  height derived from the same wrong width — and it drew as a plain
     *  ellipse, which is the one shape a rock is not.
     *
     *  Now it is built: four rings of vertices (a buried foot, the shoulder
     *  where the rock is widest, a brow, and a cap that leans off centre),
     *  every one of them jittered off the placement's own id, joined into
     *  quads and painted far to near. Each face takes its tint from its true normal
     *  against a fixed light, which is what makes a flat drawing read as
     *  stone rather than a blob — one drawn ellipse has no faces to catch it.
     *
     *  The ring radii come from the plant's OWN plan mark, so the body and
     *  the mark it cross-fades into stay one rock, and the size is the
     *  catalog's spread, like every other species here.
     *
     *  The AZ Boulder has since been given the scan itself (drawAzBoulderBody);
     *  this draws the boulders that haven't.
     */
    function drawBoulderBody(
      x: number,
      z: number,
      wFt: number,
      hFt: number,
      rot: number,
      sym: PlanSymbol | null,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const R = wFt / 2;
      const N = 13; // facets around — enough to read as cut, not as a circle
      const rng = rngFor("rock:" + seed);
      const leanA = rng() * Math.PI * 2;
      const lean = 0.13 + rng() * 0.12; // how far the crown sits off centre

      type V = { sx: number; sy: number; d: number; wx: number; wy: number; wz: number };
      const ring = (frac: number, yFrac: number, jitter: number, off: number): V[] =>
        Array.from({ length: N }, (_, i) => {
          // The spokes are jittered too. On even ones the facets came out
          // as regular as a cut gem, and a 3 ft boulder read as a tent.
          const th = ((i + (rng() - 0.5) * 0.45) / N) * Math.PI * 2;
          const r =
            R * (sym ? edgeRadius(sym, th - rot) : 1) * frac *
            (1 - jitter / 2 + rng() * jitter);
          const wx = x + Math.cos(leanA) * R * off + Math.cos(th) * r;
          const wz = z + Math.sin(leanA) * R * off + Math.sin(th) * r;
          const wy = hFt * yFrac * (0.84 + rng() * 0.32);
          const q = P(wx, wy, wz);
          return { sx: q[0], sy: q[1], d: q[2], wx, wy, wz };
        });
      // Four rings, not three: a rock has a shoulder AND a brow, and the
      // band between them is where most of its faces are. With the crown
      // taken straight off the shoulder, every face ran the full height and
      // the drawing came out a cone.
      const foot = ring(0.88, 0, 0.1, 0); // the rock settles into the soil
      const shoulder = ring(1, 0.3, 0.17, lean * 0.3);
      const brow = ring(0.82, 0.63, 0.2, lean * 0.7);
      const cap = ring(0.5, 0.86, 0.26, lean);

      // Up and to the left, the light every drawing on this sheet is under.
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const faces: { vs: V[]; d: number; lit: number }[] = [];
      const face = (vs: V[]) => {
        const ax = vs[1].wx - vs[0].wx;
        const ay = vs[1].wy - vs[0].wy;
        const az = vs[1].wz - vs[0].wz;
        const bx = vs[2].wx - vs[0].wx;
        const by = vs[2].wy - vs[0].wy;
        const bz = vs[2].wz - vs[0].wz;
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        const L = Math.hypot(nx, ny, nz) || 1;
        // Absolute, so the quad's winding — which flips round the back of
        // the rock — cannot turn a face into a hole.
        const lit = Math.abs((nx * LX + ny * LY + nz * LZ) / L);
        faces.push({ vs, d: vs.reduce((s, v) => s + v.d, 0) / vs.length, lit });
      };
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        face([foot[i], foot[j], shoulder[j], shoulder[i]]);
        face([shoulder[i], shoulder[j], brow[j], brow[i]]);
        face([brow[i], brow[j], cap[j], cap[i]]);
      }
      face(cap);
      faces.sort((p, q) => q.d - p.d); // far first, so near stone covers it

      const tint = sel ? gold : verde;
      ctx!.lineJoin = "round";
      for (const f of faces) {
        ctx!.beginPath();
        ctx!.moveTo(f.vs[0].sx, f.vs[0].sy);
        for (let i = 1; i < f.vs.length; i++) ctx!.lineTo(f.vs[i].sx, f.vs[i].sy);
        ctx!.closePath();
        // Paper under every face, or the translucent tints stack and the
        // far side of the rock shows through the near one.
        ctx!.fillStyle = LEAF_BODY;
        ctx!.fill();
        ctx!.fillStyle = tint(0.05 + 0.2 * (1 - f.lit));
        ctx!.fill();
        // The facet edges carry the drawing: at a hairline they dissolved
        // into the fills and the rock went back to being a blob.
        ctx!.strokeStyle = tint(0.5);
        ctx!.lineWidth = lw * 0.85;
        ctx!.stroke();
      }

      // The silhouette, drawn over the facets at full weight: the edge of a
      // rock is a hard line, and face strokes alone leave it furry.
      const hull = convexHull(
        [...foot, ...shoulder, ...brow, ...cap].map((v): [number, number] => [v.sx, v.sy]),
      );
      if (hull.length < 3) return;
      ctx!.beginPath();
      ctx!.moveTo(hull[0][0], hull[0][1]);
      for (let i = 1; i < hull.length; i++) ctx!.lineTo(hull[i][0], hull[i][1]);
      ctx!.closePath();
      ctx!.strokeStyle = sel ? GOLD : verde(0.7);
      ctx!.lineWidth = lw * 1.2;
      ctx!.stroke();
    }

    function drawInstance(inst: Instance, g: number, t: number) {
      const { meta } = inst;
      const st = stateRef.current;
      // Editing addresses ONE plant; browsing still highlights the species,
      // which is how a designer finds where they put the hopseeds.
      const sel = st.editing
        ? st.selectedId === inst.id
        : st.selected === inst.model;
      // Nothing else says a plant is clickable, or WHICH one a click would
      // land on — the hit radius is generous and the symbols crowd.
      const hover = st.editing && !sel && hoverRef.current === inst.id;
      const grows = !["boulder", "poolPrefab", "light"].includes(meta.kind);
      const gr = grows ? g : 1;
      const stroke = sel || hover ? GOLD : verde(0.85);
      const fill = sel ? gold(0.14) : hover ? gold(0.07) : verde(0.08);
      const lw = sel ? 2 : hover ? 1.8 : 1.4;
      // A boulder is the rock its size places; a plant, its mature size.
      const sf = sizeFactor(inst.model, meta.kind, inst.scale);
      const h = meta.renderHeightFt * gr * sf;
      const rw = (meta.matureWidthFt / 2) * gr * sf;
      const { x, z } = inst;
      const planSym = symbolFor(inst.model, meta.kind);
      const symRot = (inst.yawDeg * Math.PI) / 180;

      // A plant's 3D body and its flat plan mark are two drawings of the
      // same thing, and neither survives the other's camera: tilted, the
      // mark smears across the floor; from straight above, the body sits on
      // top of the mark it belongs to. So they trade places as the camera
      // swings, rather than both being drawn at once.
      //   A pool has no plan symbol of its own — its footprint IS the body,
      //   so it stays drawn. A light's cone is the only thing showing where
      //   the fixture aims, so the cone stays too.
      const bodyA = meta.kind === "poolPrefab" ? 1 : 1 - t;
      const markA = meta.kind === "light" ? 1 : t;

      ctx!.globalAlpha = bodyA;
      if (inst.model === "WhiteDawnLantana") {
        drawWhiteDawnBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "PurpleLantana") {
        drawPurpleLantanaBody(x, z, h, rw, symRot, inst.id, sel || hover);
      } else if (inst.model === "YellowLantana") {
        drawYellowLantanaBody(x, z, h, rw, symRot, inst.id, sel || hover);
      } else if (inst.model === "GreenHopseed") {
        drawHopseedBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "TexasSage") {
        drawTexasSageBody(x, z, h, rw, inst.id, sel || hover, lw);
      } else if (inst.model === "YellowBells") {
        drawYellowBellsBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "RedBirdOfParadise") {
        drawRedBirdBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "Jojoba") {
        drawJojobaBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "LittleJohnBottlebrush") {
        drawBottlebrushBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "PaloVerde") {
        drawPaloVerdeBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "HoneyMesquite") {
        drawMesquiteBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (EBONY_MODELS.has(inst.model)) {
        drawEbonyBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (MULGA_MODELS.has(inst.model)) {
        drawMulgaBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "Vitex") {
        drawChasteBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "MexicanFencePost") {
        drawFencePostBody(x, z, h, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "OrganPipe") {
        drawOrganPipeBody(x, z, h, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "ArgentineToothpick") {
        drawToothpickBody(x, z, h, symRot, inst.id, sel || hover, lw);
      } else if (inst.model === "TotemPole") {
        drawTotemBody(x, z, h, symRot, sel || hover);
      } else if (inst.model === "MadagascarPalm") {
        drawMadagascarBody(x, z, h, symRot, sel || hover, lw);
      } else if (inst.model === "Firestick") {
        drawFirestickBody(x, z, h, symRot, sel || hover, lw);
      } else if (meta.kind === "tree" || meta.kind === "shrub") {
        const isShrub = meta.kind === "shrub";
        if (!isShrub) drawTrunk(x, z, h, rw, symRot, sel ? GOLD : verde(0.7), lw);
        ctx!.lineWidth = lw;
        ctx!.strokeStyle = stroke;
        ctx!.fillStyle = fill;
        // The canopy carries the WHOLE plan mark, lifted — outline and the
        // branching inside it. The silhouette alone is the generic shape of
        // a canopy; the limbs are what say which tree it is.
        const canopyY = h * (isShrub ? 0.45 : 0.66);
        // A symbol with no outline has no canopy disc either: on a mulga the
        // branches ARE the canopy, and a disc behind them is a shape the
        // tree does not have.
        const massed = planSym?.edge !== "none";
        if (massed) {
          symbolPath3D(ctx!, P, x, canopyY, z, rw, planSym, symRot);
          ctx!.fill();
        }
        if (planSym) {
          drawPlanSymbol(ctx!, P, x, z, rw, planSym, {
            rot: symRot,
            stroke,
            detail: sel ? GOLD : verde(0.42),
            lw,
            markR: ftPx(x, z, rw),
            seed: inst.model,
            y: canopyY,
          });
        } else {
          ctx!.stroke();
        }
        if (massed) {
          symbolPath3D(ctx!, P, x, h * (isShrub ? 0.8 : 0.92), z, rw * 0.55, planSym, symRot, 48);
          ctx!.fill();
          ctx!.stroke();
        }
      } else if (meta.kind === "palm") {
        const top = [x, h, z] as const;
        const tp = P(...top);
        const base = P(x, 0, z);
        ctx!.strokeStyle = verde(0.7);
        ctx!.lineWidth = Math.max(ftPx(x, z, 0.3), 1.2);
        ctx!.beginPath();
        ctx!.moveTo(base[0], base[1]);
        ctx!.lineTo(tp[0], tp[1]);
        ctx!.stroke();
        ctx!.strokeStyle = stroke;
        ctx!.lineWidth = lw;
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + 0.4;
          const tip = P(
            top[0] + Math.cos(a) * 4.2 * gr,
            top[1] - 1.9 * gr,
            top[2] + Math.sin(a) * 4.2 * gr
          );
          const c = P(
            top[0] + Math.cos(a) * 1.7 * gr,
            top[1] + 1.2 * gr,
            top[2] + Math.sin(a) * 1.7 * gr
          );
          ctx!.beginPath();
          ctx!.moveTo(tp[0], tp[1]);
          ctx!.quadraticCurveTo(c[0], c[1], tip[0], tip[1]);
          ctx!.stroke();
        }
      } else if (meta.kind === "saguaro" || meta.kind === "columnar") {
        const base = P(x, 0, z);
        const top = P(x, h, z);
        const bodyR = Math.min(rw, 0.9);
        ctx!.strokeStyle = stroke;
        ctx!.lineCap = "round";
        ctx!.lineWidth = Math.max(ftPx(x, z, bodyR) * 2, 3);
        ctx!.beginPath();
        ctx!.moveTo(base[0], base[1]);
        ctx!.lineTo(top[0], top[1]);
        ctx!.stroke();
        if (meta.kind === "saguaro") {
          ctx!.lineWidth = Math.max(ftPx(x, z, bodyR) * 1.2, 2);
          for (const [dx, y0, y1] of [
            [1.9, 0.42, 0.74],
            [-1.9, 0.52, 0.66],
          ]) {
            const j0 = P(x, h * y0, z);
            const j1 = P(x + dx * gr, h * y0, z);
            const j2 = P(x + dx * gr, h * y1, z);
            ctx!.beginPath();
            ctx!.moveTo(j0[0], j0[1]);
            ctx!.lineTo(j1[0], j1[1]);
            ctx!.lineTo(j2[0], j2[1]);
            ctx!.stroke();
          }
        }
        ctx!.lineCap = "butt";
      } else if (inst.model === "GoldenBarrel") {
        drawGoldenBarrelBody(x, z, h, rw, symRot, inst.id, sel || hover);
      } else if (meta.kind === "barrel") {
        drawBarrelBody(x, z, h, rw, symRot, stroke, fill, lw);
      } else if (inst.model === "AZBoulder1") {
        drawAzBoulderBody(x, z, rw, symRot, sel || hover, lw);
      } else if (meta.kind === "boulder") {
        drawBoulderBody(x, z, rw * 2, h, symRot, planSym, inst.id, sel, lw);
      } else if (inst.model === "Ocotillo") {
        drawOcotilloBody(x, z, h, rw, symRot, inst.id, sel || hover);
      } else if (inst.model.startsWith("YuccaRostrata")) {
        drawBeakedYuccaBody(x, z, h, rw, symRot, inst.id, sel || hover);
      } else if (inst.model === "AgaveTruncata") {
        drawTruncataBody(x, z, h, symRot, sel || hover, lw);
      } else if (inst.model === "AgaveAmericana") {
        drawAmericanaBody(x, z, h, symRot, sel || hover, lw);
      } else if (inst.model === "TropicalAgave") {
        drawTropicalAgaveBody(x, z, h, symRot, sel || hover, lw);
      } else if (inst.model === "AloeFerox") {
        drawFeroxBody(x, z, h, symRot, sel || hover, lw);
      } else if (inst.model === "Aloe Vera") {
        drawAloeBody(x, z, h, rw, symRot, inst.id, sel || hover ? gold : verde, stroke, lw, !(sel || hover));
      } else if (meta.kind === "rosette") {
        const bp = P(x, 0, z);
        ctx!.strokeStyle = stroke;
        ctx!.lineWidth = Math.max(lw - 0.2, 1.2);
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2 + 0.2;
          const lift = 0.55 + 0.45 * Math.abs(Math.sin(k * 1.7));
          const tip = P(
            x + Math.cos(a) * rw,
            h * lift,
            z + Math.sin(a) * rw
          );
          const c = P(x + Math.cos(a) * rw * 0.25, h * 0.95, z + Math.sin(a) * rw * 0.25);
          ctx!.beginPath();
          ctx!.moveTo(bp[0], bp[1]);
          ctx!.quadraticCurveTo(c[0], c[1], tip[0], tip[1]);
          ctx!.stroke();
        }
      } else if (meta.kind === "light") {
        const base = P(x, 0, z);
        const top = P(x, Math.max(h, 0.5), z);
        ctx!.strokeStyle = sel ? GOLD : verde(0.7);
        ctx!.lineWidth = 1.4;
        ctx!.beginPath();
        ctx!.moveTo(base[0], base[1]);
        ctx!.lineTo(top[0], top[1]);
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(top[0], top[1], 2.5, 0, 7);
        ctx!.fillStyle = sel ? GOLD : gold(0.7);
        ctx!.fill();
      } else if (meta.kind === "poolPrefab") {
        // Footprint rectangle 10ft × 6ft × scale, rotated by yaw.
        const L = 5 * inst.scale;
        const Wd = 3 * inst.scale;
        const a = (inst.yawDeg * Math.PI) / 180;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const corners: [number, number][] = (
          [
            [-L, -Wd],
            [L, -Wd],
            [L, Wd],
            [-L, Wd],
          ] as [number, number][]
        ).map(([px, pz]) => [x + px * ca - pz * sa, z + px * sa + pz * ca]);
        pathPoly(corners);
        ctx!.fillStyle = WATER_FILL;
        ctx!.fill();
        ctx!.strokeStyle = sel ? GOLD : verde(0.5);
        ctx!.lineWidth = lw;
        ctx!.stroke();
        pathPoly(shrink(corners, 0.75));
        ctx!.strokeStyle = WATER_LINE;
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }

      ctx!.globalAlpha = 1;

      /* ground symbol + label + hit target */
      const symR = Math.max(rw, meta.kind === "poolPrefab" ? 5 * inst.scale : 1);
      const c0 = P(x, 0.02, z);
      // The plan symbol: the mark the blueprint prints, drawn flat on the
      // ground — so plan mode here and the printed sheet are one drawing.
      ctx!.globalAlpha = markA;
      if (planSym && markA > 0.004) {
        drawPlanSymbol(ctx!, P, x, z, symR, planSym, {
          rot: symRot,
          stroke: sel ? GOLD : verde(meta.kind === "boulder" ? 0.45 : 0.62),
          detail: sel ? GOLD : verde(0.4),
          lw: sel ? 1.6 : 1,
          markR: ftPx(x, z, symR),
          seed: inst.model,
        });
      }
      ctx!.globalAlpha = 1;
      const labelA = Math.max(t, sel ? 1 : 0);
      if (labelA > 0.45) {
        ctx!.font = "600 10px ui-monospace, Menlo, monospace";
        ctx!.fillStyle = sel ? GOLD : ink(0.6 * labelA);
        const label =
          sel && inst.containerType
            ? `${meta.code} · ${inst.containerType}`
            : meta.code;
        ctx!.fillText(label, c0[0] + ftPx(x, z, symR) * 0.72 + 4, c0[1] - 4);
      }
      ctx!.setLineDash([]);
      hits.push({
        model: inst.model,
        id: inst.id,
        sx: c0[0],
        sy: c0[1],
        r: Math.max(ftPx(x, z, symR), 16),
      });
    }

    function render() {
      updateCam();
      const t = cur.planT;
      const g = cur.growth;
      ctx!.clearRect(0, 0, W, H);
      ctx!.fillStyle = SAND;
      ctx!.fillRect(0, 0, W, H);
      hits.length = 0;

      /* ground + grid clipped to boundary (or content bounds) */
      const groundPts: [number, number][] =
        scene.boundary.length >= 3
          ? scene.boundary
          : [
              [cx - R, cz - R],
              [cx + R, cz - R],
              [cx + R, cz + R],
              [cx - R, cz + R],
            ];
      pathPoly(groundPts);
      ctx!.fillStyle = GROUND;
      ctx!.fill();
      ctx!.save();
      pathPoly(groundPts);
      ctx!.clip();
      ctx!.strokeStyle = verde(0.09);
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      const gx0 = Math.floor((cx - R) / 5) * 5;
      const gz0 = Math.floor((cz - R) / 5) * 5;
      for (let x = gx0; x <= cx + R; x += 5) {
        const a = P(x, 0, cz - R);
        const b = P(x, 0, cz + R);
        ctx!.moveTo(a[0], a[1]);
        ctx!.lineTo(b[0], b[1]);
      }
      for (let z = gz0; z <= cz + R; z += 5) {
        const a = P(cx - R, 0, z);
        const b = P(cx + R, 0, z);
        ctx!.moveTo(a[0], a[1]);
        ctx!.lineTo(b[0], b[1]);
      }
      ctx!.stroke();
      ctx!.restore();

      /* hardscape areas */
      for (const hs of scene.hardscape) {
        pathPoly(hs.pts);
        if (hs.style === "pool") {
          ctx!.fillStyle = WATER_FILL;
          ctx!.fill();
        } else {
          ctx!.fillStyle = "#e8ddc2";
          ctx!.fill();
          if (hs.style === "turf") hatch(hs.pts, verde(0.18), 5);
          else if (hs.style === "decomposedGranite" || hs.style === "flagstone")
            dots(hs.pts, verde(0.22), 9);
          else hatch(hs.pts, verde(0.13), 8);
        }
        pathPoly(hs.pts);
        ctx!.strokeStyle = verde(0.4);
        ctx!.lineWidth = 1;
        ctx!.stroke();
        if (t > 0.5) {
          const [lx, lz] = centroid(hs.pts);
          const s = P(lx, 0.02, lz);
          ctx!.font = "500 10px ui-monospace, Menlo, monospace";
          ctx!.textAlign = "center";
          ctx!.fillStyle = ink(0.55 * t);
          ctx!.fillText(
            `${hs.label.toUpperCase()} · ${Math.round(hs.sqFt)} SF`,
            s[0],
            s[1]
          );
          ctx!.textAlign = "left";
        }
      }

      /* flat features (everything except extruded structures) */
      const flat = scene.features.filter(
        (f) => !["House", "Garage", "Shed"].includes(f.kind)
      );
      for (const f of flat) {
        if (f.kind === "Pool") {
          pathPoly(f.pts);
          ctx!.fillStyle = WATER_FILL;
          ctx!.fill();
          ctx!.strokeStyle = verde(0.4);
          ctx!.lineWidth = 1.2;
          ctx!.stroke();
          for (const factor of [0.82, 0.6]) {
            pathPoly(shrink(f.pts, factor));
            ctx!.strokeStyle = WATER_LINE;
            ctx!.lineWidth = 1;
            ctx!.stroke();
          }
        } else if (["Patio", "Driveway", "Walkway", "Deck"].includes(f.kind)) {
          pathPoly(f.pts);
          ctx!.fillStyle = "#e8ddc2";
          ctx!.fill();
          ctx!.strokeStyle = verde(0.35);
          ctx!.lineWidth = 1;
          ctx!.stroke();
          if (f.kind === "Walkway") dots(f.pts, verde(0.2), 8);
          else hatch(f.pts, verde(0.12), 8);
        } else {
          pathPoly(f.pts);
          ctx!.strokeStyle = verde(0.45);
          ctx!.lineWidth = 1.2;
          ctx!.setLineDash([4, 3]);
          ctx!.stroke();
          ctx!.setLineDash([]);
        }
        if (t > 0.5 && f.kind !== "Pool") {
          const [lx, lz] = centroid(f.pts);
          const s = P(lx, 0.02, lz);
          ctx!.font = "500 10px ui-monospace, Menlo, monospace";
          ctx!.textAlign = "center";
          ctx!.fillStyle = ink(0.5 * t);
          ctx!.fillText(f.label.toUpperCase(), s[0], s[1]);
          ctx!.textAlign = "left";
        }
      }

      /* boundary */
      if (scene.boundary.length >= 3) {
        pathPoly(scene.boundary);
        ctx!.strokeStyle = verde(0.85);
        ctx!.lineWidth = 1.6;
        ctx!.setLineDash([7, 4]);
        ctx!.stroke();
        ctx!.setLineDash([]);
      }

      /* removal markers */
      for (const rm of scene.removals) {
        const s = P(rm.x, 0.02, rm.z);
        ctx!.strokeStyle = CLAY;
        ctx!.lineWidth = 1.4;
        circle3D(rm.x, 0.02, rm.z, rm.r);
        ctx!.stroke();
        const d = ftPx(rm.x, rm.z, rm.r) * 0.7;
        ctx!.beginPath();
        ctx!.moveTo(s[0] - d, s[1] - d * 0.5);
        ctx!.lineTo(s[0] + d, s[1] + d * 0.5);
        ctx!.stroke();
      }

      /* extruded structures + instances, painter-sorted */
      const items: { d: number; draw: () => void }[] = scene.instances.map(
        (inst) => ({
          d: P(inst.x, 0, inst.z)[2],
          draw: () => drawInstance(inst, g, t),
        })
      );
      for (const f of scene.features) {
        if (!["House", "Garage", "Shed"].includes(f.kind)) continue;
        const [fx, fz] = centroid(f.pts);
        const hFt = f.kind === "Shed" ? 8 : 9;
        items.push({
          d: P(fx, hFt / 2, fz)[2],
          draw: () => drawExtruded(f.pts, hFt, f.label, t),
        });
      }
      items.sort((a, b) => b.d - a.d);
      for (const it of items) it.draw();
    }

    /* ── interaction ── */
    const pointers = new Map<number, [number, number]>();
    let dragDist = 0;
    let lastPinch = 0;
    let lastMid: [number, number] | null = null;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    function canvasXY(e: { clientX: number; clientY: number }): [number, number] {
      const r = cv!.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    /** Slide the ground so the point under `from` ends up under `to`. */
    const panBy = (from: [number, number], to: [number, number]) => {
      const a = groundAt(from[0], from[1]);
      const b = groundAt(to[0], to[1]);
      if (!a || !b) return;
      const lim = PAN_LIMIT;
      tgt.panX = clamp(tgt.panX - (b[0] - a[0]), -lim, lim);
      tgt.panZ = clamp(tgt.panZ - (b[1] - a[1]), -lim, lim);
      cur.panX = tgt.panX;
      cur.panZ = tgt.panZ;
    };
    function nearestAt(mx: number, my: number) {
      let best: { model: string; id: string } | null = null;
      let bd = 1e9;
      for (const h of hits) {
        const d = Math.hypot(h.sx - mx, h.sy - my);
        if (d < h.r && d < bd) {
          bd = d;
          best = { model: h.model, id: h.id };
        }
      }
      return best;
    }
    const nearest = (e: PointerEvent) => {
      const [mx, my] = canvasXY(e);
      return nearestAt(mx, my);
    };

    const onDown = (e: PointerEvent) => {
      cv!.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      dragDist = 0;
      cv!.style.cursor = "grabbing";
    };
    const onLeave = () => {
      hoverRef.current = null;
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) {
        const over = nearest(e);
        cv!.style.cursor = over ? "pointer" : "grab";
        hoverRef.current = over?.id ?? null;
        return;
      }
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
        const mid: [number, number] = [
          (pts[0][0] + pts[1][0]) / 2,
          (pts[0][1] + pts[1][1]) / 2,
        ];
        if (lastPinch) tgt.zoom = clamp((tgt.zoom * d) / lastPinch, ZOOM_MIN, ZOOM_MAX);
        // Two fingers drag the ground as well as pinch it, which is what
        // every map does and what hands expect.
        if (lastMid)
          panBy(
            canvasXY({ clientX: lastMid[0], clientY: lastMid[1] }),
            canvasXY({ clientX: mid[0], clientY: mid[1] }),
          );
        lastPinch = d;
        lastMid = mid;
        return;
      }
      const dx = e.clientX - prev[0];
      const dy = e.clientY - prev[1];
      dragDist += Math.abs(dx) + Math.abs(dy);
      // Plan is a map, so a plain drag moves it. 3D is a model on a turntable,
      // so a plain drag spins it and panning is the held-modifier gesture —
      // shift, the right button or the middle one.
      const pans =
        stateRef.current.mode === "plan" ||
        e.shiftKey ||
        (e.buttons & 2) !== 0 ||
        (e.buttons & 4) !== 0;
      if (pans) {
        panBy(
          canvasXY({ clientX: prev[0], clientY: prev[1] }),
          canvasXY(e),
        );
      } else if (stateRef.current.mode === "3d") {
        tgt.az = cur.az - dx * 0.4;
        tgt.el = clamp(cur.el + dy * 0.3, 8, 80);
        cur.az = tgt.az;
        cur.el = tgt.el;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastPinch = 0;
      lastMid = null;
      cv!.style.cursor = "grab";
      if (dragDist < 6) {
        const hit = nearest(e);
        if (stateRef.current.editing) {
          onSelectRef.current?.(hit?.id ?? null);
        } else if (hit) {
          selectSpecies(hit.model);
        } else {
          setSelected(null);
        }
      }
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastPinch = 0;
      lastMid = null;
      cv!.style.cursor = "grab";
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const before = tgt.zoom;
      const next = clamp(before * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX);
      if (next === before) return;
      tgt.zoom = next;
      // Zoom toward what the cursor is over, not the middle of the screen:
      // pull the look-at point part of the way to it, by exactly the amount
      // the magnification would otherwise push it off-screen.
      const g = groundAt(...canvasXY(e));
      if (!g) return;
      const k = 1 - before / next;
      tgt.panX = clamp(tgt.panX + (g[0] - (cx + cur.panX)) * k, -PAN_LIMIT, PAN_LIMIT);
      tgt.panZ = clamp(tgt.panZ + (g[1] - (cz + cur.panZ)) * k, -PAN_LIMIT, PAN_LIMIT);
    };
    // Framing got lost? Put it back. This never declines — a double click on
    // a plant means nothing else here, and a reset that refuses when you are
    // lost is worse than one that fires when you did not mean it.
    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      Object.assign(tgt, stateRef.current.mode === "plan" ? VPLAN : V3D);
      tgt.zoom = 1;
      tgt.panX = 0;
      tgt.panZ = 0;
      cam.saved3d = { ...V3D };
    };
    // Right-drag is a pan, so it must not also raise the browser menu.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    if (!embed) {
      cv.addEventListener("pointerdown", onDown);
      cv.addEventListener("pointermove", onMove);
      cv.addEventListener("pointerleave", onLeave);
      cv.addEventListener("pointerup", onUp);
      cv.addEventListener("pointercancel", onCancel);
      cv.addEventListener("wheel", onWheel, { passive: false });
      cv.addEventListener("dblclick", onDblClick);
      cv.addEventListener("contextmenu", onContextMenu);
    }

    /* ── loop ── */
    let raf = 0;
    const frame = () => {
      if (embed && !reducedMotion) {
        cur.az += 0.05; // slow ambient orbit for the preview card
        tgt.az = cur.az;
      }
      const m = stateRef.current.mode;
      if (m !== lastMode) {
        if (lastMode === "3d")
          cam.saved3d = { az: cur.az, el: cur.el, dist: cur.dist, fov: cur.fov };
        Object.assign(tgt, m === "plan" ? VPLAN : cam.saved3d);
        tgt.planT = m === "plan" ? 1 : 0;
        lastMode = m;
      }
      tgt.growth = 1;
      for (const k of ["az", "el", "dist", "fov", "zoom", "planT", "growth", "panX", "panZ"] as const) {
        cur[k] += (tgt[k] - cur[k]) * K;
        if (Math.abs(tgt[k] - cur[k]) < 0.0005) cur[k] = tgt[k];
      }
      if (W > 0 && H > 0) render();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onCancel);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("dblclick", onDblClick);
      cv.removeEventListener("contextmenu", onContextMenu);
    };
    // scene is the only real dependency; selectSpecies is stable.
  }, [scene, selectSpecies, embed]);

  /* ── UI ───────────────────────────────────────────────────────── */

  const seg = (active: boolean) =>
    `px-3.5 py-1.5 text-[13px] transition ${
      active
        ? "bg-ink/[0.07] font-semibold text-ink"
        : "text-muted hover:text-ink"
    }`;

  const canvasPane = (
    <div
      ref={wrapRef}
      className={embed ? "relative h-full w-full" : "relative min-h-0 flex-1"}
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full touch-none ${
          embed ? "" : "cursor-grab"
        }`}
        role="img"
        aria-label={`Interactive plan of ${projectName}. Drag to orbit, tap a plant to highlight that species.`}
      />
      {!embed && editing && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 border-2 border-accent/70"
        />
      )}
      {!embed && onToggleEditing && (
        <button
          type="button"
          onClick={onToggleEditing}
          aria-pressed={editing}
          // Being in a mode is not an action to take. While editing, this
          // is a quiet escape hatch — the one filled green button on screen
          // is Publish, which is the thing that actually finishes the work.
          // Both being filled green made them fight over "done".
          className={`absolute left-3.5 top-3 rounded-lg border px-3.5 py-1.5 text-[13px] font-semibold backdrop-blur transition ${
            editing
              ? "border-accent/40 bg-card/85 text-accent-dim hover:bg-card"
              : "border-rule-strong bg-card/90 text-ink shadow-[0_6px_18px_-10px_rgba(28,42,33,0.6)] hover:bg-card"
          }`}
        >
          {editing ? "✕ Exit editing" : "Edit design"}
        </button>
      )}
      {!embed && (
        <>
          <p className="pointer-events-none absolute right-3.5 top-3 text-right font-mono text-[11px] leading-relaxed text-faint">
            {mode === "plan"
              ? "drag to pan · scroll to zoom"
              : "drag to orbit · shift-drag to pan · scroll to zoom"}
            <br />
            double-click to reset the view
            <br />
            {editing ? "click a plant to edit it" : "tap a plant to find its kind"}
          </p>
          <p className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            {projectName} · drawn to scale from headset data · Verde Vision
          </p>
        </>
      )}
    </div>
  );

  if (embed) return canvasPane;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#ebe0cb] text-ink">
      {/* top bar */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-4 py-2.5 sm:px-5">
        {backHref && (
          <Link
            href={backHref}
            onClick={(e) => {
              // The guard returns true when it has taken over — it puts up
              // its own prompt, so this navigation must not also happen.
              if (onBeforeLeave?.()) e.preventDefault();
            }}
            className="flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
          >
            <span aria-hidden>←</span> Dashboard
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg text-ink sm:text-xl">
          {projectName}
        </h1>

        <div className="flex items-center gap-2.5">
          <div className="flex overflow-hidden rounded-lg border border-rule bg-card">
            <button
              type="button"
              className={seg(mode === "3d")}
              aria-pressed={mode === "3d"}
              onClick={() => setMode("3d")}
            >
              3D
            </button>
            <button
              type="button"
              className={seg(mode === "plan")}
              aria-pressed={mode === "plan"}
              onClick={() => setMode("plan")}
            >
              Plan
            </button>
          </div>
          {(documents?.blueprint || documents?.estimate) && (
            <div className="flex overflow-hidden rounded-lg border border-rule bg-card">
              {documents.blueprint && (
                <a
                  href={documents.blueprint}
                  target="_blank"
                  rel="noopener"
                  className={seg(false)}
                >
                  Blueprint PDF
                </a>
              )}
              {documents.estimate && (
                <a
                  href={documents.estimate}
                  target="_blank"
                  rel="noopener"
                  className={seg(false)}
                >
                  Estimate PDF
                </a>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {canvasPane}

        {/* rail — or the editor, while editing */}
        <aside className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-rule bg-card/60 md:max-h-none md:w-[320px] md:border-l md:border-t-0">
          {editing && editorPanel ? (
            editorPanel
          ) : (
          <>
          <div className="border-b border-rule px-4 py-3">
            <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-faint">
              Plant material
            </h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rail.rows.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted">
                Nothing placed yet — plants will appear here after the next
                sync from the headset.
              </p>
            )}
            {rail.rows.map((row) => {
              const isSel = selected === row.model;
              return (
                <button
                  key={row.model}
                  type="button"
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.model, el);
                    else rowRefs.current.delete(row.model);
                  }}
                  onClick={() => selectSpecies(row.model)}
                  aria-pressed={isSel}
                  className={`flex w-full items-center gap-3 border-b border-rule px-4 py-2.5 text-left transition ${
                    isSel ? "bg-gold/10" : "hover:bg-ink/[0.04]"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold ${
                      isSel
                        ? "border-gold text-gold"
                        : "border-accent/50 text-accent"
                    }`}
                  >
                    {row.meta.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {row.meta.name}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      ×{row.qty}
                      {row.unitLabel && ` · ${row.unitLabel}`}
                      {showPrices && row.unitPrice != null && (
                        <> · {currency.format(row.unitPrice)} ea</>
                      )}
                    </span>
                  </span>
                  {showPrices && (
                    <span
                      className={`shrink-0 font-mono text-sm tabular-nums ${
                        isSel ? "font-semibold text-gold" : "text-body"
                      }`}
                    >
                      {row.lineTotal != null ? currency.format(row.lineTotal) : "—"}
                    </span>
                  )}
                </button>
              );
            })}
            {scene.removals.length > 0 && (
              <div className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-clay/50 font-mono text-[10px] font-semibold text-clay">
                  RM
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">
                    Existing plant removal
                  </span>
                  <span className="block text-xs text-muted">
                    ×{scene.removals.length} marked in the yard
                  </span>
                </span>
              </div>
            )}
          </div>
          {showPrices && (
            <div className="border-t border-rule px-4 py-3">
              {rail.subtotal != null && (
                <div className="flex items-baseline justify-between">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-faint">
                    Materials subtotal
                  </span>
                  <span className="font-mono text-sm tabular-nums text-body">
                    {currency.format(rail.subtotal)}
                  </span>
                </div>
              )}
              {estimateAmount != null && (
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-faint">
                    Project estimate
                  </span>
                  <span className="font-mono text-lg font-semibold tabular-nums text-ink">
                    {currency.format(estimateAmount)}
                  </span>
                </div>
              )}
            </div>
          )}
          </>
          )}
        </aside>
      </div>
    </div>
  );
}
