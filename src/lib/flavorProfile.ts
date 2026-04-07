/**
 * Generates a deterministic flavor profile for a restaurant based on
 * its cuisine type and name (used as a seed for variation).
 */

interface FlavorData {
  subject: string;
  value: number;
  fullMark: number;
}

// Base flavor profiles by cuisine
const CUISINE_PROFILES: Record<string, number[]> = {
  // [Umami, Sweet, Sour, Bitter, Salty, Spicy]
  italian:       [120, 80, 75, 60, 100, 40],
  french:        [130, 90, 70, 80, 95, 35],
  japanese:      [140, 60, 80, 70, 110, 50],
  sushi:         [135, 55, 85, 65, 115, 45],
  chinese:       [120, 85, 80, 60, 105, 90],
  korean:        [125, 65, 85, 70, 100, 120],
  thai:          [110, 90, 100, 60, 95, 130],
  indian:        [115, 75, 70, 80, 90, 135],
  mexican:       [105, 70, 95, 55, 85, 125],
  mediterranean: [120, 75, 90, 75, 95, 55],
  american:      [110, 85, 60, 65, 105, 50],
  seafood:       [130, 55, 75, 60, 120, 40],
  steakhouse:    [140, 50, 55, 70, 120, 45],
  pizza:         [115, 80, 75, 55, 110, 50],
  cafe:          [70, 120, 65, 110, 60, 30],
  bakery:        [60, 140, 50, 80, 70, 20],
  vegan:         [85, 90, 95, 100, 65, 60],
  'bar & grill': [110, 70, 65, 85, 105, 60],
  breakfast:     [90, 110, 55, 75, 95, 35],
  caribbean:     [105, 95, 80, 50, 85, 110],
};

const DEFAULT_PROFILE = [100, 80, 75, 70, 90, 65];

// Simple hash from a string to get deterministic variation
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getFlavorProfile(cuisineTypes: string[], restaurantName: string): FlavorData[] {
  const subjects = ['Umami', 'Sweet', 'Sour', 'Bitter', 'Salty', 'Spicy'];

  // Find matching base profile
  let base = DEFAULT_PROFILE;
  for (const t of cuisineTypes) {
    const key = t.toLowerCase().replace(/_/g, ' ').replace('restaurant', '').trim();
    if (CUISINE_PROFILES[key]) {
      base = CUISINE_PROFILES[key];
      break;
    }
  }

  // Add deterministic variation based on restaurant name
  const seed = hashStr(restaurantName);
  return subjects.map((subject, i) => ({
    subject,
    value: Math.min(150, Math.max(20, base[i] + ((seed >> (i * 4)) % 31) - 15)),
    fullMark: 150,
  }));
}

export function getTopFlavors(data: FlavorData[], count = 2): string[] {
  return [...data]
    .sort((a, b) => b.value - a.value)
    .slice(0, count)
    .map((d) => d.subject);
}
