export type GeoCoordinate = readonly [longitude: number, latitude: number];

export type KmlRoute = {
  readonly id: string;
  readonly title: string;
  readonly coordinates: readonly GeoCoordinate[];
};

export type SvgRouteGeometry = {
  path: string;
  viewBox: string;
};

const EARTH_RADIUS_METERS = 6_378_137;
const DEG_TO_RAD = Math.PI / 180;
const VIEWBOX_PADDING_RATIO = 0.06;

function projectToWebMercator([longitude, latitude]: GeoCoordinate) {
  const longitudeRadians = longitude * DEG_TO_RAD;
  const latitudeRadians = latitude * DEG_TO_RAD;

  return {
    x: EARTH_RADIUS_METERS * longitudeRadians,
    y: -EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)),
  };
}

function formatSvgNumber(value: number) {
  return Number(value.toFixed(3));
}

export function createSvgRouteGeometry(coordinates: readonly GeoCoordinate[]): SvgRouteGeometry {
  if (coordinates.length < 2) {
    throw new Error('A route needs at least two coordinates.');
  }

  const projected = coordinates.map(projectToWebMercator);
  let minX = projected[0].x;
  let maxX = projected[0].x;
  let minY = projected[0].y;
  let maxY = projected[0].y;

  for (const point of projected.slice(1)) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const padding = Math.max(width, height) * VIEWBOX_PADDING_RATIO;
  const normalized = projected.map(({ x, y }) => ({
    x: formatSvgNumber(x - minX),
    y: formatSvgNumber(y - minY),
  }));
  const path = normalized
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');

  return {
    path,
    viewBox: [
      formatSvgNumber(-padding),
      formatSvgNumber(-padding),
      formatSvgNumber(width + padding * 2),
      formatSvgNumber(height + padding * 2),
    ].join(' '),
  };
}
