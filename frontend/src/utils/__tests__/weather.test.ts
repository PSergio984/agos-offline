import { describe, it, expect } from 'vitest';
import { getComfortType, getStormRiskType } from '../weather';

// Covers every label the backend weather_mappers can emit.
describe('getComfortType', () => {
  it.each([
    ['Cool', 'good'],
    ['Comfortable', 'good'],
    ['Cool & damp', 'moderate'],
    ['Warm & humid', 'moderate'],
    ['Hot but tolerable', 'moderate'],
    ['Very hot', 'moderate'],
    ['Uncomfortable', 'bad'],
    ['Oppressive', 'bad'],
    ['Heat stress risk', 'bad'],
  ])('maps "%s" to "%s"', (level, expected) => {
    expect(getComfortType(level)).toBe(expected);
  });
});

describe('getStormRiskType', () => {
  it.each([
    ['None', 'good'],
    ['Low', 'good'],
    ['Possible', 'moderate'],
    ['Likely', 'bad'],
  ])('maps "%s" to "%s"', (level, expected) => {
    expect(getStormRiskType(level)).toBe(expected);
  });
});
