// Default vocabularies surfaced as autocomplete suggestions in the
// Advanced Recipe Builder's tag + equipment inputs. These aren't
// hard-coded constraints — the user can still type any custom value —
// just sensible jumping-off catalogues so the dropdown isn't empty on
// first focus. Lists are kept lowercase-with-hyphens so they normalize
// cleanly in the chip view; the display layer adds a "#" prefix for
// tags and capitalizes equipment as appropriate.

export const DEFAULT_RECIPE_TAGS: string[] = [
  // Cuisines
  'italian', 'mexican', 'french', 'chinese', 'japanese', 'korean', 'thai',
  'vietnamese', 'indian', 'spanish', 'greek', 'middle-eastern', 'mediterranean',
  'american', 'southern', 'cajun', 'creole', 'soul-food', 'caribbean',
  'latin-american', 'peruvian', 'brazilian', 'ethiopian', 'moroccan',
  'lebanese', 'turkish', 'german', 'british', 'irish', 'fusion',

  // Diet
  'vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free', 'egg-free',
  'keto', 'paleo', 'low-carb', 'low-fat', 'low-sugar', 'low-sodium',
  'high-protein', 'whole30', 'pescatarian', 'kosher', 'halal', 'plant-based',

  // Time / pace
  '15-minute', '30-minute', '1-hour', 'weekend-project', 'slow-cook',
  'make-ahead', 'no-cook', 'overnight', 'quick', 'one-pot', 'one-pan',
  'sheet-pan', 'meal-prep', 'leftovers',

  // Occasion
  'weeknight', 'date-night', 'dinner-party', 'brunch', 'picnic', 'potluck',
  'summer-bbq', 'game-day', 'holiday', 'thanksgiving', 'christmas',
  'easter', 'halloween', 'valentines', 'birthday', 'super-bowl', 'oscars',

  // Course
  'breakfast', 'lunch', 'dinner', 'snack', 'appetizer', 'side', 'dessert',
  'drinks', 'salad', 'soup', 'sandwich', 'main-course', 'small-plate',

  // Season
  'spring', 'summer', 'fall', 'winter', 'holiday-season',

  // Technique
  'baked', 'roasted', 'fried', 'pan-fried', 'deep-fried', 'air-fried',
  'grilled', 'broiled', 'sauteed', 'braised', 'smoked', 'raw', 'fermented',
  'pickled', 'cured', 'steamed', 'poached', 'seared', 'caramelized',
  'instant-pot', 'slow-cooker', 'pressure-cooker', 'sous-vide', 'dutch-oven',
  'cast-iron', 'wok', 'no-bake',

  // Ingredient / theme
  'chicken', 'beef', 'pork', 'lamb', 'turkey', 'duck', 'seafood', 'fish',
  'shrimp', 'salmon', 'tuna', 'shellfish', 'tofu', 'tempeh', 'eggs',
  'pasta', 'rice', 'noodles', 'pizza', 'tacos', 'burger', 'bowl',
  'casserole', 'stew', 'curry', 'bread', 'cake', 'cookie', 'pie', 'tart',
  'cocktail', 'mocktail',

  // Vibe / lifestyle
  'comfort-food', 'light', 'fresh', 'hearty', 'indulgent', 'healthy',
  'kid-friendly', 'family-friendly', 'crowd-pleaser', 'budget-friendly',
  'spicy', 'sweet', 'savory', 'umami', 'classic', 'modern', 'rustic',
  'elegant', 'street-food',
];

export const DEFAULT_EQUIPMENT: string[] = [
  // Pots & pans
  'Cast iron skillet', '12" cast iron skillet', 'Nonstick skillet',
  'Stainless steel skillet', 'Sauté pan', 'Saucepan', 'Stockpot',
  'Dutch oven', 'Wok', 'Griddle', 'Grill pan', 'Omelet pan',
  'Pressure cooker', 'Slow cooker', 'Rice cooker', 'Instant pot',

  // Bakeware
  'Sheet pan', 'Half sheet pan', 'Baking sheet', 'Rimmed baking sheet',
  'Baking dish', '9×13 baking dish', 'Casserole dish', 'Roasting pan',
  'Broiler pan', 'Springform pan', 'Loaf pan', 'Tube pan', 'Bundt pan',
  'Muffin tin', 'Cake pan', 'Round cake pan', 'Pie dish', 'Tart pan',
  'Ramekins', 'Cooling rack',

  // Knives & cutting
  "Chef's knife", 'Paring knife', 'Serrated knife', 'Bread knife',
  'Boning knife', 'Fillet knife', 'Santoku knife', 'Mandoline',
  'Cutting board', 'Knife sharpener', 'Honing steel',

  // Small appliances
  'Stand mixer', 'Hand mixer', 'Immersion blender', 'Blender',
  'High-speed blender', 'Food processor', 'Mini chopper', 'Spice grinder',
  'Juicer', 'Espresso machine', 'Coffee grinder', 'Electric kettle',
  'Toaster', 'Toaster oven', 'Air fryer', 'Sous vide', 'Dehydrator',
  'Ice cream maker', 'Waffle iron', 'Microwave',

  // Mixing & prep
  'Mixing bowl', 'Large mixing bowl', 'Glass bowl', 'Metal bowl',
  'Prep bowl', 'Whisk', 'Balloon whisk', 'Spatula', 'Rubber spatula',
  'Offset spatula', 'Fish spatula', 'Wooden spoon', 'Slotted spoon',
  'Ladle', 'Tongs', 'Kitchen tweezers', 'Peeler', 'Y-peeler',
  'Grater', 'Microplane', 'Box grater', 'Zester', 'Can opener',
  'Bottle opener', 'Corkscrew', 'Jar opener',

  // Measurement
  'Measuring cups', 'Measuring spoons', 'Liquid measuring cup',
  'Kitchen scale', 'Digital scale', 'Instant-read thermometer',
  'Candy thermometer', 'Oven thermometer', 'Probe thermometer',
  'Timer',

  // Baking & pastry
  'Parchment paper', 'Aluminum foil', 'Plastic wrap', 'Silicone mat',
  'Pastry brush', 'Rolling pin', 'French rolling pin', 'Dough scraper',
  'Bench scraper', 'Pastry cutter', 'Biscuit cutter', 'Cookie cutter',
  'Piping bag', 'Pastry tips',

  // Straining & sifting
  'Sieve', 'Fine-mesh strainer', 'Colander', 'Spider strainer',
  'Salad spinner', 'Cheesecloth', 'Nut milk bag', 'Sifter',

  // Specialty
  'Mortar and pestle', 'Suribachi', 'Donabe', 'Tagine', 'Paella pan',
  'Crepe pan', 'Fondue pot', 'Pizza stone', 'Pizza peel', 'Pizza cutter',
  'Smoker', 'Charcoal grill', 'Gas grill', 'Kettle grill',

  // Storage
  'Airtight containers', 'Mason jars', 'Ziplock bags', 'Vacuum sealer',
];

/** Sort + dedupe a free-form list against the catalogue. Used to seed
 *  the input from an existing recipe — keeps the user's custom entries
 *  alongside the catalogue ones without re-ordering them. */
export function mergeIntoCatalogue(existing: string[], catalogue: string[]): string[] {
  const seen = new Set(catalogue.map((c) => c.toLowerCase()));
  const extras = existing.filter((e) => !seen.has(e.toLowerCase()));
  return [...catalogue, ...extras];
}
