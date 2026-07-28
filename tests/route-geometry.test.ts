import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSvgRouteGeometry, type GeoCoordinate, type KmlRoute } from '../src/components/percurso/routeGeometry';
import { route10km } from '../src/components/percurso/route10km';
import { route5km } from '../src/components/percurso/route5km';

const routeCases = [
  { route: route5km, file: 'public/routes/FUNPACE RUN - 5KM.kml', expectedCount: 12 },
  { route: route10km, file: 'public/routes/FUNPACE RUN - 10KM.kml', expectedCount: 20 },
] as const;

function coordinatesFromKml(kml: string): GeoCoordinate[] {
  const coordinateBlock = kml.match(/<coordinates>([\s\S]*?)<\/coordinates>/)?.[1];
  assert.ok(coordinateBlock, 'KML must contain a coordinates element');

  return coordinateBlock
    .trim()
    .split(/\s+/)
    .map((coordinate) => {
      const [longitude, latitude] = coordinate.split(',').map(Number);
      return [longitude, latitude] as const;
    });
}

for (const { route, file, expectedCount } of routeCases) {
  test(`${route.id} data matches its KML source coordinate by coordinate`, async () => {
    const kml = await readFile(file, 'utf8');
    const sourceCoordinates = coordinatesFromKml(kml);

    assert.equal(sourceCoordinates.length, expectedCount);
    assert.deepEqual(route.coordinates, sourceCoordinates);
    assert.deepEqual(route.coordinates.at(0), route.coordinates.at(-1));
  });
}

test('SVG projection keeps east to the right and north at the top', () => {
  const route: KmlRoute = {
    id: 'orientation',
    title: 'Orientation check',
    coordinates: [
      [-64, -9],
      [-63, -9],
      [-63, -8],
    ],
  };
  const { path, viewBox } = createSvgRouteGeometry(route.coordinates);
  const [, firstX, firstY, , secondX, secondY, , thirdX, thirdY] = path.split(' ');

  assert.ok(Number(secondX) > Number(firstX), 'east must increase SVG x');
  assert.equal(secondY, firstY);
  assert.equal(thirdX, secondX);
  assert.ok(Number(thirdY) < Number(secondY), 'north must decrease SVG y');
  assert.equal(viewBox.split(' ').length, 4);
});
