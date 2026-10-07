/**
 * ============================================================================
 * geo/index.ts — Barrel export for geospatial utilities
 * ============================================================================
 */

export {
  latLonToCartesian,
  cartesianToLatLon,
  ringToCartesianArray,
  surfaceNormal,
  greatCircleDistance,
  slerpOnSphere,
} from './projection';

export {
  triangulatePolygon,
  triangulateMultiPolygon,
  type TriangulatedRegion,
} from './triangulation';

export {
  parseTopoJSON,
  createDefaultRegionMetas,
  type TopoLoaderOptions,
} from './topoLoader';

export {
  SpatialIndex,
  pointInRing,
  pointInPolygon,
} from './spatialIndex';

export {
  screenToNDC,
  screenToRay,
  raySphereIntersect,
  hitPointToLatLon,
  screenToGeo,
  screenLineToGeoLine,
  type ScreenPoint,
  type Viewport,
  type Vec3,
  type Mat4,
  type Ray,
} from './screenProjection';
