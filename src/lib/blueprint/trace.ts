// What's left of the House outline card's tracing (replaced by the site
// plan builder, src/lib/site-plan): the Map view's offset, which plans
// traced on the old card still carry.

/**
 * How far to shift the Map view's tiles, in metres, so its house footprints
 * sit where the satellite has them for this property. Display only: the
 * shapes themselves are always in true (satellite) coordinates.
 */
export interface MapOffset {
  east: number;
  north: number;
}
