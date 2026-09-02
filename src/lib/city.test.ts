import { describe, it, expect } from 'vitest';
import { cityFromAddress, sameCity } from './city';

describe('cityFromAddress', () => {
  // These same addresses are run through taste_city_of in the PGlite
  // harness for migration 083 — the SQL mirrors this function.
  it.each([
    ['1397 W 6th St, Cleveland, OH 44113, USA', 'Cleveland'],
    ['150 Main St, Westport, CT 06880, USA', 'Westport'],
    ['New York, NY, USA', 'New York'],
    ['181 Thompson St, New York, NY 10012', 'New York'],
    ['12 Rue de Rivoli, 75004 Paris, France', 'Paris'],
    ['8 Quai du Louvre, Paris, France', 'Paris'],
    ['Wildersgade 10B, 1408 København, Denmark', 'København'],
    ['Hotel d\'Angleterre, Kongens Nytorv 34, 1050 København, Denmark', 'København'],
    ['1 Square Beaumarchais, 98000 Monaco', 'Monaco'],
    ['100, 2000 Dorado Beach Drive, Dorado, 00646, Puerto Rico', 'Dorado'],
    ['accès piétonnier, Rue du Barri, 06360 Èze, France', 'Èze'],
    ['12 Upper St, London N1 1AB, UK', 'London'],
    ['1 Chome-2-3 Ginza, Chuo City, Tokyo 104-0061, Japan', 'Tokyo'],
    ['2 Harrison St, New York', 'New York'],
    ['Paris', 'Paris'],
    ['', ''],
    // Country-less addresses whose last segment IS the city — a shape rule
    // used to eat these.
    ['Osteria, Via Roma 5, Bologna', 'Bologna'],
    ['Flat 4, 12 Baker Street, Marylebone, London', 'London'],
    ['Sushi Bar, 1-2-3 Ginza, Chuo City, Tokyo', 'Tokyo'],
    // Spelled-out states.
    ['123 Main St, Columbus, Ohio 43215, USA', 'Columbus'],
    ['Ocean Drive, Miami Beach, Florida 33139, USA', 'Miami Beach'],
    ['1 Queen St, Brisbane City, Queensland 4000, Australia', 'Brisbane City'],
    // Two-token postcodes in front of the city.
    ['Prinsengracht 263, 1016 GV Amsterdam, Netherlands', 'Amsterdam'],
    ['Prinsengracht 263, 1016 GV Amsterdam', 'Amsterdam'],
    ['Karlova 1, 110 00 Praha 1, Czechia', 'Praha 1'],
    ['Wildersgade 10B, København, Denmark', 'København'],
  ])('%s → %s', (addr, city) => {
    expect(cityFromAddress(addr)).toBe(city);
  });
});

describe('sameCity', () => {
  it('ignores case, accents and punctuation', () => {
    expect(sameCity('Èze', 'eze')).toBe(true);
    expect(sameCity('St. Louis', 'st louis')).toBe(true);
    expect(sameCity('', '')).toBe(false);
  });
});
