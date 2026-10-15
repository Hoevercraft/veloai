import { createBrouter } from './brouter.js';
import { createOverpass } from './overpass.js';
import { createGeocoder } from './geocode.js';
import { createMockRouting, createMockPois, createMockGeocoder } from './mock.js';

// Zentrale Stelle für alle externen Dienste. Mit ?mock=1 in der URL
// laufen Routing, Kandidatensuche und Ortssuche komplett offline.

export function isMockMode(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get('mock') === '1';
}

export function createServices({ mock = isMockMode() } = {}) {
  if (mock) {
    return { mock: true, routing: createMockRouting(), pois: createMockPois(), geocoder: createMockGeocoder() };
  }
  return { mock: false, routing: createBrouter(), pois: createOverpass(), geocoder: createGeocoder() };
}
