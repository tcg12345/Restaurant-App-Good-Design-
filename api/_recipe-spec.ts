// Shared recipe-authoring spec — the single source of truth used by BOTH
// AI recipe paths so they produce equally thorough, precise recipes:
//   • api/build-recipe.ts  — the "Create with AI" Add-Recipe modal generator
//   • api/location-chat.ts — the "Ask a local" chat's build_recipe tool
//
// (Underscore-prefixed so Vercel treats it as a private module, not a route.)

export const CUISINE_HINT =
  'Afghan, African, American, Argentinian, Australian, Austrian, BBQ, Bakery, Belgian, Brazilian, British, Cajun, Caribbean, Chinese, Cuban, Dessert, Ethiopian, Filipino, French, Fusion, German, Greek, Hawaiian, Indian, Indonesian, Irish, Israeli, Italian, Jamaican, Japanese, Korean, Latin American, Lebanese, Malaysian, Mediterranean, Mexican, Middle Eastern, Moroccan, Nordic, Pakistani, Peruvian, Polish, Portuguese, Russian, Scandinavian, Seafood, Soul Food, Southern, Spanish, Sri Lankan, Swedish, Tex-Mex, Thai, Turkish, Ukrainian, Vegan, Vegetarian, Vietnamese';

export const COURSE_HINT = 'Breakfast, Lunch, Dinner, Snack, Dessert, Drinks, Appetizer, Side';

// The quality bar that calibrates depth/precision/timing to the dish's
// complexity and the chosen difficulty. Authoritative for both paths.
export const RECIPE_QUALITY_BAR = [
  'SCALE DEPTH TO THE DISH. First, silently judge how technically demanding the dish is, then match your level of detail to it:',
  '- Forgiving, everyday dishes (sheet-pan dinners, simple pastas, stir-fries, salads, quick soups, drop cookies, smoothies): be CONCISE — a handful of clear steps. Do NOT pad them with needless precision or ceremony.',
  '- Technically demanding dishes — in BAKING and COOKING alike — earn exhaustive detail. This includes laminated/enriched doughs (croissants, danish, brioche), breads and sourdough, pastry and choux, confectionery and sugar work, tempered chocolate, custards and emulsions (crème anglaise, hollandaise, mayonnaise), anything fermented or cured, and multi-component, multi-stage, or multi-day dishes (stocks, braises, confit, terrines, consommé, mole, risotto done properly). For these, leave nothing to guesswork.',
  '- The dish\'s inherent complexity sets a FLOOR: never drop a technique step essential to success just to keep things short.',
  '',
  'DIFFICULTY CALIBRATION. You are given a target difficulty (or asked to infer one). Within the floor above, calibrate prose AND depth:',
  '- Easy — make it genuinely approachable for a nervous beginner. For a demanding dish you MAY offer a simpler or faster BUT STILL RELIABLE variant (e.g. a rough-puff shortcut instead of full lamination); trim to the essential moves, coach warmly in plain language, name common pitfalls kindly, and define any technical term the first time you must use it. Approachable, not exhaustive — but never a broken or fake method.',
  '- Medium — write for a confident home cook. Balanced detail: clear technique with the key whys, sensible measurements, a few pro cues. No hand-holding, no over-explaining.',
  '- Hard — write for an ambitious cook chasing a professional result. Be rigorous and complete: exact temperatures, dimensions and roll-out sizes, fold/shaping schemes and layer counts, gluten-rest and freeze/temper steps, and sensory doneness cues. Assume technical vocabulary; do not water it down.',
  '- If no difficulty is given, do NOT simplify — produce the BEST, most authentic version of the dish, scaled to its true complexity (simple dishes stay simple; demanding dishes get the full rigorous treatment). Then set the `difficulty` field to whatever the finished recipe actually is.',
  '',
  'GRANULARITY. Use as many steps as the dish genuinely needs, each specific and descriptive. Demanding dishes usually mean many fine-grained steps (a separate step per fold, rest, and roll-out with exact dimensions). But do NOT pad — a recipe well covered in fewer strong steps beats a bloated one.',
  '',
  'PRECISION (apply in full to demanding dishes; lightly to simple ones):',
  '- Use mass in grams for all baking and confectionery. When a volume measure genuinely helps the cook, put it parenthetically in the ingredient `name` (e.g. name "bread flour (about 2 cups)", amount "250", unit "g").',
  '- Put exact temperatures (oven, dough, butter, syrup, internal), exact dimensions and roll-out sizes at each stage, and fold/lamination schemes directly in the step `body`.',
  '- Give sensory doneness cues, not just clock times ("bake until deep amber and the layers feel set — pull on color, not the clock"). Note finishing-timing rules where they matter (e.g. egg-wash only just before baking).',
  '',
  'TIMING (must be honest):',
  '- `prepTime` = hands-on active minutes only. `cookTime` = active bake/cook/sear minutes.',
  '- Put ALL passive time — proofing, fermentation, chilling, resting, freezing, marinating, cooling, setting — into `chillTime`, summed across every stage. NEVER fold passive time into prep/cook, and NEVER present a misleadingly small total for a long project.',
  '- Set each step\'s `durationMin` (including any passive wait it contains) so per-step times add up.',
  '- For any long or overnight/multi-day project, add a `makeAhead` note with a realistic timeline (e.g. "Plan across 2 days: Day 1 mix and chill overnight; Day 2 laminate, proof ~2 hr, bake. Active time ~1 hr 45 min; total elapsed ~14 hr").',
  '',
  'STRUCTURE:',
  '- Sensible step ordering; one clear action per step, each with a short imperative `title`.',
  '- Group the METHOD into sections with `stepGroups` whenever the dish is built from distinct components or stages — e.g. a Beef Wellington with "For the duxelles", "For the crêpes", "Sear & wrap the beef", "Assemble & bake", or a laminated dough with "Make the détrempe", "Laminate", "Shape & proof", "Bake". Each section is a named run of steps. Use the flat `steps` list instead for a simple single-flow recipe. Use ONE of `stepGroups` or `steps`, never both. Number of sections should match the dish\'s real components — do not invent sections for a simple recipe.',
  '- Group ingredients with `ingredientGroups` ONLY when the recipe truly has distinct stages ("For the détrempe", "For the butter block"); otherwise use the flat `ingredients` list.',
  '- Include the `equipment` the cook needs and 1–3 genuinely useful `notes` (a chef tip, a substitution, or a make-ahead). Complex projects warrant the make-ahead timeline note above.',
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
    body: { type: 'string', description: 'One clear action per step. For demanding dishes include exact temperatures, dimensions/roll-out sizes, fold or shaping schemes, and sensory doneness cues — not just clock times.' },
    durationMin: { type: 'integer', minimum: 0, description: 'Minutes this step takes, including any passive wait (proof/chill/rest) it contains, so per-step times sum to the real total.' },
    tip: { type: 'string', description: 'Optional inline tip for this step.' },
  },
};

// The build_recipe tool INPUT SCHEMA (the recipe object shape + field
// guidance). Shared verbatim so both paths emit identical, richly-described
// recipe JSON. Each caller wraps it with its own tool name/description.
export const RECIPE_INPUT_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: {
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
