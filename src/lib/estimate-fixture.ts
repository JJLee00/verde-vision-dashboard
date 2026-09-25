import type { EstimateItem, EstimateSettings } from "@/lib/estimate";

// A believable bid for /dashboard/projects/fixture/estimate in development:
// AR-derived plant and hardscape rows plus the hand-typed lines that are the
// entire reason the builder exists. Shared with the PDF route so the
// proposal can be rendered and reviewed with no database and no login —
// same role FIXTURE_PROJECT plays for the living-blueprint viewer.

type Seed = Partial<EstimateItem> & { id: string; sortOrder: number };

const SEEDS: Seed[] = [
  { id: "f1", sortOrder: 10, description: "(15g) Green Hopseed", category: "plant", quantity: 9, unit: "each", unitPrice: 118, source: "ar", arKey: "plant:green hopseed:15g" },
  { id: "f2", sortOrder: 20, description: "(5g) Regal Mist", category: "plant", quantity: 14, unit: "each", unitPrice: 42, source: "ar", arKey: "plant:regal mist:5g" },
  { id: "f3", sortOrder: 30, description: '(24" Box) Texas Ebony', category: "plant", quantity: 2, unit: "each", unitPrice: 385, source: "ar", arKey: "plant:texas ebony:24in box" },
  { id: "f4", sortOrder: 40, description: "Sierra paver patio", category: "hardscape", quantity: 340, unit: "ft²", unitPrice: 14.25, source: "ar", arKey: "hardscape:a41f" },
  { id: "f5", sortOrder: 50, description: "Irrigation system modification", category: "irrigation", quantity: 1, unit: "ls", unitPrice: 1200, note: "Includes 2 valves; excludes trenching under the drive." },
  { id: "f6", sortOrder: 60, description: "Remove 3 oleanders + stump grind", category: "demolition", quantity: 1, unit: "ls", unitPrice: 850 },
  { id: "f7", sortOrder: 70, description: "Dump fees", category: "fee", quantity: 2, unit: "load", unitPrice: 225 },
  { id: "f8", sortOrder: 80, description: "Delivery", category: "delivery", quantity: 1, unit: "trip", unitPrice: 185 },
  { id: "f9", sortOrder: 90, description: "Install labor", category: "labor", quantity: 36, unit: "hr", unitPrice: 62.5, taxable: false },
];

export const FIXTURE_ITEMS: EstimateItem[] = SEEDS.map((seed) => {
  const base: EstimateItem = {
    id: seed.id,
    sortOrder: seed.sortOrder,
    description: "",
    category: "other",
    quantity: 1,
    unit: "each",
    unitPrice: 0,
    total: 0,
    taxable: true,
    note: null,
    source: "manual",
    arKey: null,
    priceOverridden: false,
  };
  const merged = { ...base, ...seed };
  return {
    ...merged,
    total: Math.round(merged.quantity * merged.unitPrice * 100) / 100,
  };
});

export const FIXTURE_SETTINGS: EstimateSettings = {
  taxRate: 8.6,
  depositPercent: 30,
  detail: "itemized",
};

export const FIXTURE_SAVED_ITEMS = [
  { id: "s1", name: "Dump fees", category: "fee", price: 225, unit: "load" },
  { id: "s2", name: "Delivery", category: "delivery", price: 185, unit: "trip" },
  { id: "s3", name: "Tree trimming", category: "service", price: 145, unit: "hr" },
  { id: "s4", name: "Misc. irrigation materials", category: "irrigation", price: 350, unit: "ls" },
  { id: "s5", name: "Install labor", category: "labor", price: 62.5, unit: "hr" },
];

export const FIXTURE_PROJECT_META = {
  name: "Hoffman Residence",
  date: "2026-09-18",
  address: "27210 N Rio Verde Dr, Rio Verde, AZ",
  contactEmail: "hoffmans@example.com",
};

// Stands in for an org that has filled in its branding, so the letterhead
// can be judged before migration-015 makes those columns real.
export const FIXTURE_ORG = {
  name: "Verde Landscaping Inc.",
  logo: null,
  phone: "(480) 555-0142",
  email: "office@verdelandscapinginc.com",
  address: "Rio Verde, AZ",
  website: "verdelandscapinginc.com",
  licenseNumber: "ROC #307998",
  terms:
    "Estimate valid for 30 days. A deposit is due on acceptance; the balance is due on completion. Plant material is warranted for 90 days from installation when the irrigation schedule provided is followed. Prices assume normal digging conditions — rock excavation, caliche, or unmarked utilities may require a change order. Any change to the scope above will be quoted in writing before the work is performed.",
};
