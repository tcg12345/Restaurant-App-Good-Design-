/**
 * Restaurant data extracted from Supabase "restaurants" table.
 * Deduplicated — for restaurants with multiple entries, the one with the
 * highest rating (or most complete data) is kept.
 */

export interface ImportRestaurant {
  name: string;
  address: string;
  city: string;
  cuisine: string;
  rating: number | null;    // 0–10 scale, null = not rated
  notes: string;
  dateVisited: string;       // ISO string or empty
  priceRange: number;        // 1–4 ($–$$$$)
}

const restaurants: ImportRestaurant[] = [
  { name: "Pléntitude", address: "8 Quai de la Louvre, 75001 Paris, France", city: "Paris", cuisine: "French", rating: 9.97, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Manhatta", address: "28 Liberty St 60th floor, New York, NY 10005, USA", city: "New York", cuisine: "American", rating: 9.15, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Jean-Georges", address: "1 Central Prk W, New York, NY 10023, USA", city: "New York", cuisine: "French", rating: null, notes: "Added from Global Search", dateVisited: "", priceRange: 4 },
  { name: "Kalaya", address: "4 W Palmer St, Philadelphia, PA 19125, USA", city: "Philadelphia", cuisine: "Thai", rating: 9.73, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Kawa Ni", address: "19A Bridge Square, Westport, CT 06880, USA", city: "Westport", cuisine: "Korean", rating: 6.23, notes: "", dateVisited: "", priceRange: 2 },
  { name: "CORK Kitchen & Wine Bar", address: "15000 N Secret Springs Dr, Marana, AZ 85658, USA", city: "Marana", cuisine: "American", rating: 8.15, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Gymkhana", address: "42 Albemarle St, London W1S 4JH, UK", city: "London", cuisine: "Indian", rating: 10.0, notes: "", dateVisited: "2025-08-13T23:00:00+00:00", priceRange: 4 },
  { name: "Portland City Grill", address: "111 SW 5th Ave 30th Floor, Portland, OR 97204, USA", city: "Portland", cuisine: "Steakhouse", rating: 7.1, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Le Bernardin", address: "155 W 51st St, New York, NY 10019, USA", city: "New York", cuisine: "Seafood", rating: null, notes: "Le Bernardin is a world-renowned, Michelin three-star seafood restaurant", dateVisited: "", priceRange: 4 },
  { name: "Gramercy Tavern", address: "42 E 20th St, New York, NY 10003, USA", city: "New York", cuisine: "American", rating: 7.72, notes: "Gramercy Tavern is a celebrated New American restaurant in Manhattan", dateVisited: "", priceRange: 4 },
  { name: "Happy Monkey by Jean-Georges", address: "376 Greenwich Ave, Greenwich, CT 06830, USA", city: "Greenwich", cuisine: "Mexican", rating: 8.4, notes: "", dateVisited: "", priceRange: 3 },
  { name: "sketch", address: "9 Conduit St, London W1S 2XG, UK", city: "London", cuisine: "French", rating: 6.78, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Le George", address: "31 Av. George V, 75008 Paris, France", city: "Paris", cuisine: "Mediterranean", rating: 7.73, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Gabriel Kreuther", address: "41 W 42nd St, New York, NY 10036, USA", city: "New York", cuisine: "French", rating: null, notes: "Added from Global Search", dateVisited: "", priceRange: 4 },
  { name: "Toca Madera Scottsdale", address: "4736 N Goldwater Blvd, Scottsdale, AZ 85251, USA", city: "Scottsdale", cuisine: "Mexican", rating: 9.05, notes: "", dateVisited: "", priceRange: 3 },
  { name: "La Tête d'Or by Daniel", address: "318 Park Ave S, New York, NY 10010, USA", city: "New York", cuisine: "French", rating: 9.11, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Semma", address: "60 Greenwich Ave, New York, NY 10011, USA", city: "New York", cuisine: "Indian", rating: null, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Eat Modern Mediterranean", address: "1601 Kings Hwy, Fairfield, CT 06824, USA", city: "Fairfield", cuisine: "Mediterranean", rating: 8.12, notes: "", dateVisited: "", priceRange: 2 },
  { name: "Washington Prime", address: "141 Washington St, Norwalk, CT 06854, USA", city: "Norwalk", cuisine: "Steakhouse", rating: 5.2, notes: "", dateVisited: "", priceRange: 3 },
  { name: "The Black Pig", address: "Borough Market Kitchen, Winchester Walk, London SE1 9AG, UK", city: "London", cuisine: "Spanish", rating: 7.32, notes: "", dateVisited: "2025-08-15T04:00:00+00:00", priceRange: 1 },
  { name: "Jean-Georges Philadelphia", address: "One N 19th St, Philadelphia, PA 19103, USA", city: "Philadelphia", cuisine: "French", rating: 9.17, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Le Tout Paris", address: "8 Quai de Louvre, 75001 Paris, France", city: "Paris", cuisine: "French", rating: 6.42, notes: "", dateVisited: "", priceRange: 4 },
  { name: "The Cottage Restaurant", address: "3215 Parkway, Pigeon Forge, TN 37863, USA", city: "Pigeon Forge", cuisine: "American", rating: 2.93, notes: "", dateVisited: "", priceRange: 2 },
  { name: "Positive Sand Bar", address: "Rockefeller Nature Trail, Dorado, 00646, Puerto Rico", city: "Dorado", cuisine: "Asian", rating: 9.46, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Blue Hill At Stone Barns", address: "630 Bedford Rd, Tarrytown, NY 10591, USA", city: "Tarrytown", cuisine: "American", rating: 10.0, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Nosy Restaurant", address: "188 Strand, Temple, London WC2R 1EA, UK", city: "London", cuisine: "Modern", rating: 9.81, notes: "", dateVisited: "2025-08-14T23:00:00+00:00", priceRange: 4 },
  { name: "Ostra", address: "1 Charles St S, Boston, MA 02116, USA", city: "Boston", cuisine: "Seafood", rating: 8.11, notes: "", dateVisited: "", priceRange: 4 },
  { name: "4 Charles Prime Rib", address: "4 Charles St, New York, NY 10014, USA", city: "New York", cuisine: "Steakhouse", rating: null, notes: "4 Charles Prime Rib is an intimate, upscale steakhouse in the West Village", dateVisited: "", priceRange: 4 },
  { name: "Crown Shy", address: "70 Pine St Ground Floor, New York, NY 10005, USA", city: "New York", cuisine: "American", rating: 8.77, notes: "", dateVisited: "", priceRange: 3 },
  { name: "The Foyer & Reading Room", address: "Claridge's, Brook St, London W1K 4HR, UK", city: "London", cuisine: "Classic", rating: 8.54, notes: "", dateVisited: "", priceRange: 3 },
  { name: "COA", address: "100, 2000 Dorado Beach Drive, Dorado, 00646, Puerto Rico", city: "Dorado", cuisine: "American", rating: 9.06, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Gabriele's of Westport", address: "27 Powers Ct, Westport, CT 06880, USA", city: "Westport", cuisine: "Italian", rating: 6.65, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Barbounia", address: "250 Park Ave S, New York, NY 10003, USA", city: "New York", cuisine: "Mediterranean", rating: 8.93, notes: "", dateVisited: "", priceRange: 2 },
  { name: "Nobu Washington D.C.", address: "2525 M St NW, Washington, DC 20037, USA", city: "Washington", cuisine: "Japanese", rating: 9.02, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Dinner by Heston Blumenthal", address: "66 Knightsbridge, London SW1X 7LA, UK", city: "London", cuisine: "Modern", rating: 9.36, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Buddakan", address: "75 9th Ave, New York, NY 10011, USA", city: "New York", cuisine: "Asian", rating: 9.0, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Jules Verne", address: "Avenue Gustave Eiffel 2ème, Tour Eiffel, Av. Anatole France, 75007 Paris, France", city: "Paris", cuisine: "French", rating: 8.67, notes: "", dateVisited: "2025-09-17T04:00:00+00:00", priceRange: 4 },
  { name: "COTE Korean Steakhouse", address: "16 W 22nd St, New York, NY 10010, USA", city: "New York", cuisine: "Korean", rating: 9.24, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Evelyn's", address: "525 N Fort Lauderdale Beach Blvd, Fort Lauderdale, FL 33304, USA", city: "Fort Lauderdale", cuisine: "Mediterranean", rating: 9.32, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Francine Restaurant", address: "4710 N Goldwater Blvd, Scottsdale, AZ 85251, USA", city: "Scottsdale", cuisine: "French", rating: 7.81, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Reef Restaurant & Lounge", address: "605 S 3rd St, Philadelphia, PA 19147, USA", city: "Philadelphia", cuisine: "Seafood", rating: 7.21, notes: "", dateVisited: "", priceRange: 2 },
  { name: "Per Se", address: "10 Columbus Cir, New York, NY 10019, USA", city: "New York", cuisine: "French", rating: 8.5, notes: "", dateVisited: "", priceRange: 4 },
  { name: "The FillEr-Up", address: "22107 York Rd, Parkton, MD 21120, USA", city: "Parkton", cuisine: "American", rating: 8.22, notes: "", dateVisited: "", priceRange: 1 },
  { name: "ROVI", address: "59 Wells Street, Fitzrovia, 59-65 Wells St, London W1A 3AE, UK", city: "London", cuisine: "Mediterranean", rating: 6.8, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Charleston", address: "1000 Lancaster St, Baltimore, MD 21202, USA", city: "Baltimore", cuisine: "Fine Dining", rating: 8.89, notes: "Charleston is a renowned fine dining restaurant in Baltimore", dateVisited: "", priceRange: 4 },
  { name: "Didon", address: "8 Rue du Dragon, 75006 Paris, France", city: "Paris", cuisine: "French", rating: 7.32, notes: "", dateVisited: "2025-08-18T04:00:00+00:00", priceRange: 3 },
  { name: "Michael's on the Hill", address: "100 N, 4182 Waterbury-Stowe Rd, Waterbury Center, VT 05677, USA", city: "Stowe", cuisine: "American", rating: 7.46, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Tamarind", address: "20 Queen St, London W1J 5PR, UK", city: "London", cuisine: "Indian", rating: 9.9, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Shell & Bones Oyster Bar and Grill", address: "100 S Water St, New Haven, CT 06519, USA", city: "New Haven", cuisine: "Seafood", rating: 6.24, notes: "", dateVisited: "", priceRange: 3 },
  { name: "OKO westport", address: "6 Wilton Rd, Westport, CT 06880, USA", city: "Westport", cuisine: "Japanese", rating: 7.88, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Restaurant Gordon Ramsay", address: "68 Royal Hospital Rd, London SW3 4HP, UK", city: "London", cuisine: "Fine Dining", rating: 7.93, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Girafe Restaurant", address: "1 Pl. du Trocadéro et du 11 Novembre, 75016 Paris, France", city: "Paris", cuisine: "French", rating: 8.26, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Knife & Spoon", address: "4012 Central Florida Pkwy, Orlando, FL 32837, USA", city: "Orlando", cuisine: "Steakhouse", rating: 6.92, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Sushi Jin", address: "44 Main St, Westport, CT 06880, USA", city: "Westport", cuisine: "Japanese", rating: 6.3, notes: "", dateVisited: "2025-09-27T04:00:00+00:00", priceRange: 3 },
  { name: "The French Laundry", address: "6640 Washington St, Yountville, CA 94599, USA", city: "Yountville", cuisine: "French", rating: null, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Zaytinia", address: "1185 Broadway, New York, NY 10001, USA", city: "New York", cuisine: "Mediterranean", rating: 8.29, notes: "", dateVisited: "", priceRange: 2 },
  { name: "Tavern at GrayBarns", address: "194 Perry Ave, Norwalk, CT 06850, USA", city: "Norwalk", cuisine: "American", rating: 8.96, notes: "", dateVisited: "", priceRange: 3 },
  { name: "The Capital Grille", address: "230 Tresser Blvd, Stamford, CT 06901, USA", city: "Stamford", cuisine: "Steakhouse", rating: 6.84, notes: "", dateVisited: "", priceRange: 3 },
  { name: "The Dining Room at Edson Hill", address: "Edson Hill, 1500 Edson Hill Rd Suite 1, Stowe, VT 05672, USA", city: "Stowe", cuisine: "American", rating: 8.82, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Carbone New York", address: "181 Thompson St, New York, NY 10012, USA", city: "New York", cuisine: "Italian", rating: null, notes: "Carbone is a renowned Italian-American restaurant in Greenwich Village", dateVisited: "", priceRange: 4 },
  { name: "Bungalow", address: "24 1st Ave, New York, NY 10009, USA", city: "New York", cuisine: "Indian", rating: 8.43, notes: "", dateVisited: "", priceRange: 2 },
  { name: "Henrietta's Table", address: "1 Bennett St, Cambridge, MA 02138, USA", city: "Cambridge", cuisine: "American", rating: 8.0, notes: "Alanna", dateVisited: "", priceRange: 2 },
  { name: "Gordon Ramsay Hell's Kitchen Foxwoods", address: "350 Trolley Line Blvd, Mashantucket, CT 06338, USA", city: "Mashantucket", cuisine: "American", rating: 8.94, notes: "", dateVisited: "", priceRange: 3 },
  { name: "The Cottage", address: "256 Post Rd E, Westport, CT 06880, USA", city: "Westport", cuisine: "American", rating: 7.69, notes: "", dateVisited: "", priceRange: 2 },
  { name: "Indian Accent", address: "123 W 56th St, New York, NY 10019, USA", city: "New York", cuisine: "Indian", rating: 8.87, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Casa Sensei", address: "1200 E Las Olas Blvd STE 101, Fort Lauderdale, FL 33301, USA", city: "Fort Lauderdale", cuisine: "Asian Fusion", rating: 7.06, notes: "", dateVisited: "", priceRange: 2 },
  { name: "Sherwood Diner", address: "901 Post Rd E, Westport, CT 06880, USA", city: "Westport", cuisine: "American", rating: 4.17, notes: "", dateVisited: "", priceRange: 1 },
  { name: "Jojo by Jean-Georges", address: "160 E 64th St, New York, NY 10065, USA", city: "New York", cuisine: "French", rating: 4.97, notes: "", dateVisited: "", priceRange: 3 },
  { name: "The Fat Duck", address: "High St, Bray, Maidenhead SL6 2AQ, UK", city: "Maidenhead", cuisine: "Modern", rating: 9.49, notes: "", dateVisited: "2025-05-16T04:00:00+00:00", priceRange: 4 },
  { name: "TAO Downtown Restaurant", address: "92 9th Ave, New York, NY 10011, USA", city: "New York", cuisine: "Asian Fusion", rating: 9.01, notes: "", dateVisited: "", priceRange: 3 },
  { name: "The Inn at Pound Ridge by Jean-Georges", address: "258 Westchester Ave, Pound Ridge, NY 10576, USA", city: "Pound Ridge", cuisine: "American", rating: 7.26, notes: "", dateVisited: "", priceRange: 3 },
  { name: "La Pecora Bianca NoMad", address: "1133 Broadway, New York, NY 10010, USA", city: "New York", cuisine: "Italian", rating: 7.0, notes: "", dateVisited: "", priceRange: 1 },
  { name: "La Galerie", address: "31 Av. George V, 75008 Paris, France", city: "Paris", cuisine: "French", rating: 9.19, notes: "", dateVisited: "", priceRange: 4 },
  { name: "Janken", address: "250 NW 13th Ave, Portland, OR 97209, USA", city: "Portland", cuisine: "Japanese", rating: 9.04, notes: "", dateVisited: "", priceRange: 3 },
  { name: "Nobu Downtown", address: "195 Broadway, New York, NY 10007, USA", city: "New York", cuisine: "Japanese", rating: 8.76, notes: "", dateVisited: "", priceRange: 4 },
];

export default restaurants;
