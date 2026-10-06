// Comparing an address the designer typed with one Esri found, loosely
// enough that "6619 East Ashler Hills Dr." and "6619 E Ashler Hills Dr"
// agree, strictly enough that 6619 and 6633 don't.

// Directions and street types are spelled every which way and carry no
// identity of their own; the street's name words are what must match.
const NOISE = new Set([
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
  "st", "street", "rd", "road", "dr", "drive", "ave", "av", "avenue", "blvd", "boulevard",
  "ln", "lane", "ct", "court", "cir", "circle", "pl", "place", "way", "pkwy", "parkway",
  "trl", "trail", "ter", "terrace", "hwy", "highway", "loop", "pass", "run", "path",
]);

const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

/**
 * Whether a typed address names the house Esri found. Null when there's
 * nothing to compare — the typed address has no house number (just a
 * street, or the designer panned there without searching).
 */
export function sameHouse(
  typed: string,
  found: { number: string; street: string }
): boolean | null {
  const typedWords = words(typed);
  const number = typedWords.find((w) => /^\d+[a-z]?$/.test(w));
  if (!number) return null;
  if (number !== found.number.toLowerCase()) return false;
  const nameWords = words(found.street).filter((w) => !/^\d/.test(w) && !NOISE.has(w));
  return nameWords.every((w) => typedWords.includes(w));
}

/** The street line of an address: everything before the first comma. */
export function streetLine(address: string): string {
  return address.split(",")[0].trim();
}
