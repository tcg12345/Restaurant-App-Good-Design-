-- Published first paid-tier USD per 1,000 requests, verified 2026-09-07.
-- Owner requested published pay-as-you-go estimates, before allowances/credits/discounts.
-- Google: https://developers.google.com/maps/billing-and-pricing/pricing
-- Google field tiers: https://developers.google.com/maps/documentation/places/web-service/data-fields
-- Mapbox: https://www.mapbox.com/pricing
-- Effective for this app's analytics beginning September 7, 2026 (not a provider price-change date).
-- Exact masks only. No guessed token, video, storage, map-resource, or internal-call prices.
-- Repeat-safe; existing rows are not overwritten.
INSERT INTO public.analytics_rates(provider,endpoint,field_mask,usd_per_1000,effective_from)
VALUES
  ('google_places', 'search_text', 'places.id,places.displayName,places.location,places.rating,places.priceLevel,places.shortFormattedAddress,places.formattedAddress,places.addressComponents,places.types,places.primaryType,places.primaryTypeDisplayName,places.userRatingCount,places.regularOpeningHours', '35', '2026-09-07T00:00:00Z'),
  ('google_places', 'search_text', 'places.id,places.displayName,places.location,places.rating,places.priceLevel,places.shortFormattedAddress,places.formattedAddress,places.addressComponents,places.types,places.primaryType,places.primaryTypeDisplayName,places.userRatingCount,places.regularOpeningHours,nextPageToken', '35', '2026-09-07T00:00:00Z'),
  ('google_places', 'search_nearby', 'places.id,places.displayName,places.location,places.rating,places.priceLevel,places.shortFormattedAddress,places.formattedAddress,places.addressComponents,places.types,places.primaryType,places.primaryTypeDisplayName,places.userRatingCount,places.regularOpeningHours', '35', '2026-09-07T00:00:00Z'),
  ('google_places', 'details', 'id,displayName,location,rating,priceLevel,shortFormattedAddress,formattedAddress,addressComponents,types,primaryType,primaryTypeDisplayName,userRatingCount,nationalPhoneNumber,websiteUri,currentOpeningHours,regularOpeningHours', '20', '2026-09-07T00:00:00Z'),
  ('google_places', 'details', 'id,displayName', '17', '2026-09-07T00:00:00Z'),
  ('google_places', 'search_text', 'places.id,places.location,places.displayName', '32', '2026-09-07T00:00:00Z'),
  ('google_places', 'search_text', 'places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.types,places.primaryType,places.photos,places.businessStatus,places.servesVegetarianFood,nextPageToken', '40', '2026-09-07T00:00:00Z'),
  ('google_places', 'details', 'id,displayName,formattedAddress,location,types,primaryType,businessStatus,priceLevel,rating,photos', '20', '2026-09-07T00:00:00Z'),
  ('google_places', 'details', 'editorialSummary', '25', '2026-09-07T00:00:00Z'),
  ('google_places', 'photo', '', '7', '2026-09-07T00:00:00Z'),
  ('mapbox', 'geocoding', '', '0.75', '2026-09-07T00:00:00Z'),
  ('mapbox', 'directions', '', '2', '2026-09-07T00:00:00Z')
ON CONFLICT (provider,endpoint,field_mask,effective_from) DO NOTHING;
