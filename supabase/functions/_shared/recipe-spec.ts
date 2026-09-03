// Shared recipe-authoring spec — the single source of truth used by BOTH
// AI recipe paths so they produce equally calibrated, precise recipes:
//   • build-recipe/index.ts  — the "Create with AI" Add-Recipe modal generator
//   • location-chat/index.ts — the "Ask a local" chat's build_recipe tool

export const CUISINE_HINT =
  'Afghan, African, American, Argentinian, Australian, Austrian, BBQ, Bakery, Belgian, Brazilian, British, Cajun, Caribbean, Chinese, Cuban, Dessert, Ethiopian, Filipino, French, Fusion, German, Greek, Hawaiian, Indian, Indonesian, Irish, Israeli, Italian, Jamaican, Japanese, Korean, Latin American, Lebanese, Malaysian, Mediterranean, Mexican, Middle Eastern, Moroccan, Nordic, Pakistani, Peruvian, Polish, Portuguese, Russian, Scandinavian, Seafood, Soul Food, Southern, Spanish, Sri Lankan, Swedish, Tex-Mex, Thai, Turkish, Ukrainian, Vegan, Vegetarian, Vietnamese';

export const COURSE_HINT = 'Breakfast, Lunch, Dinner, Snack, Dessert, Drinks, Appetizer, Side';

// The quality bar that calibrates depth/precision/timing to the dish's
// complexity and the chosen difficulty. Authoritative for both paths.
export const RECIPE_QUALITY_BAR = [
  'MATCH THE RECIPE TO THE DISH — the #1 failure mode is over-complicating simple food. Before writing anything, silently judge how technically demanding the dish truly is, then write at exactly that level:',
  '- SIMPLE everyday dishes (grilled cheese, scrambled eggs, sheet-pan dinners, simple pastas, stir-fries, salads, quick soups, smoothies, drop cookies, tacos): 4–8 steps of 1–3 short sentences each, a focused ingredient list, flat `ingredients` and flat `steps` (NO groups), little or no special equipment, at most 1–2 notes. A grilled cheese is four steps, not twelve. Resist every urge to add ceremony, sub-recipes, optional flourishes, or restaurant technique the dish does not need.',
  '- MODERATE dishes (weeknight braises, risotto, roast chicken, layer cakes, yeasted breads, fresh pasta, curries built from a paste): 8–14 steps with real technique detail where the dish can fail, grouped sections only if there are genuinely distinct components.',
  '- DEMANDING projects (laminated doughs, sourdough, choux and pastry, confectionery and sugar work, tempered chocolate, custards and emulsions, fermentation and curing, multi-day or multi-component builds like mole, consommé, Beef Wellington): exhaustive detail — leave nothing to guesswork. This is the ONLY tier where very long, sectioned recipes are appropriate.',
  '- The dish\'s inherent complexity sets a FLOOR (never drop a technique step essential to success) AND a CEILING (never inflate a simple dish to look impressive). When in doubt between two lengths, choose the shorter one.',
  '',
  'DIFFICULTY CONTRACT. The target difficulty is a hard product requirement that governs WHICH version of the dish you write — technique choice, ingredient count, equipment, and step count — not just the tone of the prose:',
  '- Easy — the simplest version of the dish that still tastes genuinely good. Choose beginner-proof techniques and dependable shortcuts (rough puff instead of lamination, store-bought stock, one pan instead of three). Common supermarket ingredients only; no specialist equipment (no stand mixer, thermometer, or scale unless truly unavoidable); typically ≤10 ingredients and ≤8 steps. Plain, warm language; define any technical term you must use; name the one or two pitfalls that actually matter. The finished recipe must really BE easy — if even the simplified approach is genuinely demanding, label the difficulty honestly rather than mislabeling it Easy.',
  '- Medium — the classic home version, written for a confident cook. Proper technique with the key whys, sensible measurements, a few pro cues. No hand-holding, no over-explaining, no professional-kitchen ceremony.',
  '- Hard — the no-compromise version for an ambitious cook chasing a professional result: full classical technique, exact temperatures, dimensions and roll-out sizes, fold/shaping schemes, rest and temper steps, sensory doneness cues. Assume technical vocabulary.',
  '- If no difficulty is given, write the dish at its natural complexity (simple dishes stay simple; demanding dishes get the full treatment) and set the `difficulty` field to what the finished recipe honestly is.',
  '',
  'CONSTRAINTS ARE HARD REQUIREMENTS. When the request specifies servings, a time budget, dietary restrictions, a course, or equipment, the recipe MUST satisfy every one of them:',
  '- Servings: set `servings` to exactly the requested number and scale quantities to match.',
  '- Time budget: prepTime + cookTime + chillTime must fit within it. If the classic version cannot fit, write a faster authentic variation that can — never misreport timings to fake compliance.',
  '- Dietary restrictions are absolute — they apply to every ingredient, garnish, and suggested substitution.',
  '- Before returning, re-check the finished recipe against each stated requirement and fix any miss.',
  '',
  'STEP WRITING:',
  '- One clear action per step, each with a short imperative `title`. Sensible order.',
  '- A step\'s length must match its risk. Routine moves stay short ("Drain the pasta, reserving a cup of the water."). Where the dish can actually fail, spend the words: the action, HOW to do it well (technique, heat level), the sensory signs to watch or smell for ("cook until it smells nutty and turns the color of hazelnut shells, about 3 minutes"), and the WHY when it helps. Reserve 3–4-sentence steps for genuinely tricky moments.',
  '- Break compound actions into separate steps in demanding recipes (a step per fold, rest, roll-out, sear, deglaze); in simple recipes, combine trivial actions naturally rather than padding the count.',
  '',
  'PRECISION (apply in full to demanding dishes; lightly to simple ones):',
  '- Use mass in grams for all baking and confectionery. When a volume measure genuinely helps the cook, put it parenthetically in the ingredient `name` (e.g. name "bread flour (about 2 cups)", amount "250", unit "g"). Everyday savory cooking can stay in convenient kitchen units.',
  '- Put exact temperatures (oven, dough, butter, syrup, internal), exact dimensions and roll-out sizes at each stage, and fold/lamination schemes directly in the step `body` where they matter.',
  '- Give sensory doneness cues, not just clock times ("bake until deep amber and the layers feel set — pull on color, not the clock").',
  '',
  'TIMING (must be honest):',
  '- `prepTime` = hands-on active minutes only. `cookTime` = active bake/cook/sear minutes.',
  '- Put ALL passive time — proofing, fermentation, chilling, resting, freezing, marinating, cooling, setting — into `chillTime`, summed across every stage. NEVER fold passive time into prep/cook, and NEVER present a misleadingly small total for a long project.',
  '- Set each step\'s `durationMin` (including any passive wait it contains) so per-step times add up.',
  '- For any long or overnight/multi-day project, add a `makeAhead` note with a realistic timeline (e.g. "Plan across 2 days: Day 1 mix and chill overnight; Day 2 laminate, proof ~2 hr, bake. Active time ~1 hr 45 min; total elapsed ~14 hr").',
  '',
  'STRUCTURE:',
  '- Group the METHOD into sections with `stepGroups` ONLY when the dish is built from genuinely distinct components or stages — e.g. a Beef Wellington with "For the duxelles", "For the crêpes", "Sear & wrap the beef", "Assemble & bake". Use the flat `steps` list for any single-flow recipe. Use ONE of `stepGroups` or `steps`, never both, and never invent sections for a simple dish.',
  '- Group ingredients with `ingredientGroups` ONLY when the recipe truly has distinct stages ("For the détrempe", "For the butter block"); otherwise use the flat `ingredients` list.',
  '- List only the `equipment` the cook actually needs (skip the obvious — bowls, spoons), and 1–3 genuinely useful `notes` (a chef tip, a substitution, or a make-ahead). Complex projects warrant the make-ahead timeline note above.',
  '- Write BOTH a `summary` (one punchy line, the byline under the title) AND a longer `introParagraph` (2–4 sentences of prose for the top of the recipe page). They MUST be different: the intro describes what the dish actually is — its flavor and texture, where it comes from or when to serve it, and why it is worth cooking. Do NOT just restate the summary.',
  `- Set a sensible \`cuisine\` (examples: ${CUISINE_HINT}) and \`course\` (one or more of: ${COURSE_HINT}).`,
].join('\n');

// One method step — shared between the flat `steps` array and the steps
// inside each `stepGroups` section so both author identical step JSON.
const STEP_ITEM_SCHEMA = {
  type: 'object',
  required: ['body'],
  properties: {
    title: { type: 'string', description: 'Short imperative, e.g. "Brown the butter".' },
    body: { type: 'string', description: 'A complete instruction whose length matches the step\'s risk. Routine moves stay to one short sentence ("Drain the pasta, reserving a cup of the water."). Where the dish can fail, spend 2–4 sentences: the action, HOW to do it well (technique and heat cues), the sensory signs to watch/smell for, and the why when useful. For demanding dishes include exact temperatures, dimensions/roll-out sizes, fold or shaping schemes, and sensory doneness cues — not just clock times.' },
    durationMin: { type: 'integer', minimum: 0, description: 'Minutes this step takes, including any passive wait (proof/chill/rest) it contains, so per-step times sum to the real total.' },
    tip: { type: 'string', description: 'Optional inline tip for this step.' },
  },
};

// The build_recipe tool INPUT SCHEMA (the recipe object shape + field
// guidance). Shared verbatim so both paths emit identical, richly-described
// recipe JSON. Each caller wraps it with its own tool name/description.
/** Per-serving nutrition, as the build_recipe tool and the
 *  estimate_nutrition tool both emit it. Estimates from the ingredient
 *  list; a source page's stated values win when importing. */
export const NUTRITION_SCHEMA = {
  type: 'object',
  required: ['calories', 'protein', 'carbs', 'fat'],
  properties: {
    calories: { type: 'integer', minimum: 0, description: 'kcal per serving.' },
    protein: { type: 'integer', minimum: 0, description: 'grams per serving.' },
    carbs: { type: 'integer', minimum: 0, description: 'grams per serving (total carbohydrate).' },
    fat: { type: 'integer', minimum: 0, description: 'grams per serving (total fat).' },
    fiber: { type: 'integer', minimum: 0, description: 'grams per serving.' },
    sugar: { type: 'integer', minimum: 0, description: 'grams per serving.' },
    sodium: { type: 'integer', minimum: 0, description: 'milligrams per serving.' },
  },
};

export const RECIPE_INPUT_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: {
    nutrition: { ...NUTRITION_SCHEMA, description: 'Per-serving nutrition estimated from the ingredients and `servings`. Always include it; when transcribing a source that states nutrition, use the source\'s numbers.' },
    name: { type: 'string', description: 'Recipe title.' },
    summary: { type: 'string', description: 'One punchy line shown as the byline under the title.' },
    introParagraph: { type: 'string', description: 'A longer intro (2–4 sentences) shown at the top of the recipe page body. Describe what the dish is — its flavor/texture, origin or occasion, and why it is worth making. Must be distinct prose, NOT a repeat of `summary`. Always include it.' },
    cuisine: { type: 'string', description: `Best-fit cuisine (examples: ${CUISINE_HINT}).` },
    course: { type: 'array', items: { type: 'string' }, description: `One or more of: ${COURSE_HINT}. E.g. ["Dessert"] or ["Lunch", "Dinner"].` },
    difficulty: { type: 'string', enum: ['Easy', 'Medium', 'Hard'] },
    prepTime: { type: 'integer', minimum: 0, description: 'Minutes of hands-on prep.' },
    cookTime: { type: 'integer', minimum: 0, description: 'Minutes of cook / bake / sear time.' },
    chillTime: { type: 'integer', minimum: 0, description: 'Total passive minutes — ALL proofing, fermentation, chilling, resting, freezing, marinating, and cooling, summed across every stage. This is what makes a long project read honestly; never fold passive time into prep/cook.' },
    servings: { type: 'integer', minimum: 1 },
    yieldDescription: { type: 'string', description: 'Free-text yield label, e.g. "1 loaf (12 slices)".' },
    ingredients: {
      type: 'array',
      description: 'Flat list of ingredients for single-stage recipes. Use this OR ingredientGroups.',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Ingredient name. When a volume measure helps the cook, append it parenthetically, e.g. "bread flour (about 2 cups)".' },
          amount: { type: 'string', description: 'Number or fraction as a string. Use grams for baking/confectionery. Blank when "to taste".' },
          unit: { type: 'string', description: 'g, ml, tsp, tbsp, cup, oz, etc.' },
        },
      },
    },
    ingredientGroups: {
      type: 'array',
      description: 'Grouped ingredients for multi-stage recipes ("For the détrempe", "For the butter block"). Use either this OR ingredients — not both.',
      items: {
        type: 'object',
        required: ['name', 'ingredients'],
        properties: {
          name: { type: 'string', description: 'Section name.' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', description: 'Ingredient name. When a volume measure helps, append it parenthetically, e.g. "bread flour (about 2 cups)".' },
                amount: { type: 'string', description: 'Number or fraction as a string. Use grams for baking/confectionery. Blank when "to taste".' },
                unit: { type: 'string' },
              },
            },
          },
        },
      },
    },
    steps: {
      type: 'array',
      description: 'Ordered cooking steps for a simple single-flow recipe. Use this OR stepGroups — not both.',
      items: STEP_ITEM_SCHEMA,
    },
    stepGroups: {
      type: 'array',
      description: 'The method split into named sections — use for any dish built from distinct components or stages (e.g. a Beef Wellington: "For the duxelles", "For the crêpes", "Sear & wrap the beef", "Assemble & bake"). Each section is a named run of ordered steps; steps stay continuously numbered across sections when rendered. Use this OR the flat steps array — not both. Prefer it for multi-component dishes; use flat steps for simple ones.',
      items: {
        type: 'object',
        required: ['name', 'steps'],
        properties: {
          name: { type: 'string', description: 'Section name, e.g. "For the duxelles" or "Assembly".' },
          steps: {
            type: 'array',
            description: 'Ordered steps within this section.',
            items: STEP_ITEM_SCHEMA,
          },
        },
      },
    },
    equipment: { type: 'array', items: { type: 'string' }, description: 'Cookware, e.g. "9×5 loaf pan".' },
    tags: { type: 'array', items: { type: 'string' } },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'text'],
        properties: {
          type: { type: 'string', enum: ['tip', 'makeAhead', 'substitution', 'general'] },
          text: { type: 'string' },
        },
      },
    },
  },
};
