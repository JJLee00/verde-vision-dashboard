import type { BlueprintCandidate } from "@/lib/blueprint/types";

// The lot and house as the headset will see them on its align map: the
// aerial tile, the parcel line dashed, the house solid with its corners —
// the corners being exactly what the designer will walk to on site.
//
// Drawn in the outline's own units. The SVG viewBox IS the geo frame
// (metres from the parcel centroid, x east, z south), and SVG's y axis
// already points down = south, so north is up with no transform at all and
// the tile sits at its extent verbatim. Any flip here would be invisible on
// the dashboard and fatal in the yard — a mirrored house cannot be walked —
// which is why there is no arithmetic to get wrong.

type Pt = [number, number];

function bounds(points: Pt[]) {
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

const toPoints = (ring: Pt[]) => ring.map(([x, z]) => `${x},${z}`).join(" ");

/** Picks a round scale-bar length in feet that spans roughly a fifth of the view. */
function scaleBarFeet(viewWidthMeters: number): number {
  const target = (viewWidthMeters * 3.28084) / 5;
  const steps = [10, 20, 25, 50, 100, 200, 250, 500];
  return steps.reduce((best, s) =>
    Math.abs(s - target) < Math.abs(best - target) ? s : best
  );
}

export function OutlineMap({
  candidate,
  orthoUrl,
  className,
}: {
  candidate: Pick<BlueprintCandidate, "parcelXZ" | "houseXZ" | "imagery">;
  orthoUrl: string | null;
  className?: string;
}) {
  const parcel = candidate.parcelXZ as Pt[];
  const house = (candidate.houseXZ ?? null) as Pt[] | null;
  const extent = candidate.imagery?.orthoExtentXZ ?? null;
  const showImage = Boolean(orthoUrl && extent);

  // Frame the LOT, not the whole tile: the tile covers ~140 m around the
  // centroid, and the lot is what the designer is checking.
  const b = bounds([...parcel, ...(house ?? [])]);
  const spanX = b.maxX - b.minX;
  const spanZ = b.maxZ - b.minZ;
  const margin = Math.max(6, 0.12 * Math.max(spanX, spanZ));
  const vx = b.minX - margin;
  const vz = b.minZ - margin;
  const vw = spanX + margin * 2;
  const vh = spanZ + margin * 2;
  const unit = Math.max(vw, vh) / 100; // 1% of the view, for marks and type

  const barFeet = scaleBarFeet(vw);
  const barMeters = barFeet / 3.28084;
  const barX = vx + unit * 4;
  const barZ = vz + vh - unit * 5;

  const onImage = showImage;
  const halo = onImage ? "rgba(20,24,20,0.75)" : "transparent";
  const parcelInk = onImage ? "#f8f3e6" : "#1c2a21";
  const houseInk = onImage ? "#f2c14e" : "#2e5d43";
  const labelInk = onImage ? "#f8f3e6" : "#1c2a21";

  return (
    <svg
      viewBox={`${vx} ${vz} ${vw} ${vh}`}
      className={className}
      role="img"
      aria-label={
        house
          ? `Lot outline with the house footprint traced from aerial imagery, ${house.length} corners`
          : "Lot outline; no house footprint was found"
      }
    >
      {/* Oversized on purpose: the SVG box rarely has the lot's aspect, and
          the letterbox bands either side should read as more ground, not as
          a frame around a picture. */}
      <rect
        x={vx - vw}
        y={vz - vh}
        width={vw * 3}
        height={vh * 3}
        fill={onImage ? "#2b2f28" : "#ebe0cb"}
      />
      {showImage && extent && (
        <image
          href={orthoUrl!}
          x={extent.minX}
          y={extent.minZ}
          width={extent.maxX - extent.minX}
          height={extent.maxZ - extent.minZ}
          preserveAspectRatio="none"
        />
      )}

      {/* lot line — dashed, like a survey's property line */}
      <polygon
        points={toPoints(parcel)}
        fill="none"
        stroke={halo}
        strokeWidth={4}
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={toPoints(parcel)}
        fill="none"
        stroke={parcelInk}
        strokeWidth={1.75}
        strokeDasharray="7 5"
        vectorEffect="non-scaling-stroke"
      />

      {/* house — solid, with the walkable corners marked */}
      {house && house.length >= 3 && (
        <g>
          <polygon
            points={toPoints(house)}
            fill={onImage ? "rgba(242,193,78,0.16)" : "rgba(46,93,67,0.12)"}
            stroke={halo}
            strokeWidth={5}
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            points={toPoints(house)}
            fill="none"
            stroke={houseInk}
            strokeWidth={2.25}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {house.map(([x, z], i) => (
            <circle
              key={i}
              cx={x}
              cy={z}
              r={unit * 0.9}
              fill={houseInk}
              stroke={halo === "transparent" ? "#f5eeda" : halo}
              strokeWidth={1.25}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}

      {/* north + scale, so a dashboard reader can sanity-check orientation */}
      <g fill={labelInk} fontSize={unit * 3.4} fontFamily="ui-sans-serif, system-ui">
        <text
          x={vx + vw - unit * 4}
          y={vz + unit * 6}
          textAnchor="end"
          fontWeight={600}
          stroke={halo}
          strokeWidth={unit * 0.5}
          paintOrder="stroke"
        >
          N ↑
        </text>
        <line
          x1={barX}
          y1={barZ}
          x2={barX + barMeters}
          y2={barZ}
          stroke={labelInk}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={barX}
          y={barZ - unit * 1.5}
          stroke={halo}
          strokeWidth={unit * 0.5}
          paintOrder="stroke"
        >
          {barFeet} ft
        </text>
      </g>
    </svg>
  );
}

/** Just the lot, for telling candidate parcels apart in the picker. */
export function LotThumbnail({ parcelXZ }: { parcelXZ: [number, number][] }) {
  const b = bounds(parcelXZ);
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const margin = span * 0.1;
  return (
    <svg
      viewBox={`${b.minX - margin} ${b.minZ - margin} ${b.maxX - b.minX + margin * 2} ${b.maxZ - b.minZ + margin * 2}`}
      className="h-20 w-20 shrink-0 rounded-md border border-rule bg-paper"
      aria-hidden
    >
      <polygon
        points={toPoints(parcelXZ)}
        fill="rgba(46,93,67,0.12)"
        stroke="#1c2a21"
        strokeWidth={1.5}
        strokeDasharray="5 3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
