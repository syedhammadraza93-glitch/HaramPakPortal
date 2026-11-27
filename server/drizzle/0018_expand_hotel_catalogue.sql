-- Published walking routes terminate at a named mosque or courtyard gate.
WITH properties(city, name, stars, address, area, road, metres, reference, property_source, distance_source) AS (
  VALUES
    ('Makkah', 'Jabal Omar Hyatt Regency Makkah', 5, 'Jabal Omar, Ibrahim Al Khalil Street, Makkah 21955, Saudi Arabia', 'Jabal Omar', 'Ibrahim Al Khalil Street', 240, 'Masjid al-Haram · King Fahd Gate', 'https://www.hyatt.com/hyatt-regency/en-US/jedhr-jabal-omar-hyatt-regency-makkah/hotel-info', 'https://makkahlive.net/en/hotels/makkah'),
    ('Makkah', 'Jabal Omar Marriott Hotel, Makkah', 5, 'Umm Al Qura Street, Makkah 21955, Saudi Arabia', 'Jabal Omar', 'Umm Al Qura Street', 610, 'Masjid al-Haram · Umrah Gate', 'https://www.marriott.com/en-us/hotels/qcamc-jabal-omar-marriott-hotel-makkah/overview/', 'https://makkahlive.net/en/hotels/makkah'),
    ('Makkah', 'Swissôtel Al Maqam Makkah', 5, 'King Abdul Aziz Endowment, Tower F, Ibrahim Al Khaleel Street, Makkah 21955, Saudi Arabia', 'Clock Tower', 'Ibrahim Al Khalil Street', 380, 'Masjid al-Haram · King Abdulaziz Gate', 'https://all.accor.com/hotel/A7X4/index.en.shtml', 'https://makkahlive.net/en/hotels/makkah'),
    ('Madinah', 'InterContinental Dar Al Iman Madinah', 5, '2657 Badaah, Unit 10, Madinah 42311-6910, Saudi Arabia', 'Markaziyah', NULL, 50, 'Masjid an-Nabawi · nearest courtyard gate', 'https://www.ihg.com/intercontinental/hotels/us/en/madinah/medha/hoteldetail/directions', 'https://medina.city/hotels'),
    ('Madinah', 'Elaf Taiba Hotel', NULL, 'Saad Bin Moaaz Street, Madinah, Saudi Arabia', 'Markaziyah', 'Saad Bin Moaaz Street', 120, 'Masjid an-Nabawi · courtyard gates 326 and 327', 'https://elafgroup.com/hotel/elaf-taiba/', 'https://medina.city/hotels')
)
INSERT INTO hotels (name, destination_id, star_rating, address, area, road,
                    distance_to_haram_m, distance_reference, distance_verified_on, notes)
SELECT p.name, d.id, p.stars, p.address, p.area, p.road, p.metres, p.reference,
       DATE '2026-11-27', concat('Property address: ', p.property_source, E'\n',
         'Published walking distance: ', p.distance_source, E'\n',
         CASE WHEN p.stars IS NULL THEN 'Published star classifications conflict; confirm current classification.'
              WHEN p.city = 'Makkah' THEN 'Published star classification: https://umrahgo.co.uk/makkah-hotels'
              ELSE 'Published star classification: https://medina.city/hotels' END)
FROM properties p
JOIN LATERAL (
  SELECT id FROM destinations
  WHERE lower(city) = lower(p.city)
    AND lower(country) IN ('saudi arabia', 'ksa')
  ORDER BY is_active DESC, id
  LIMIT 1
) d ON true
WHERE NOT EXISTS (
  SELECT 1 FROM hotels h
  JOIN destinations existing ON existing.id = h.destination_id
  WHERE lower(h.name) = lower(p.name)
    AND lower(existing.city) = lower(p.city)
    AND lower(existing.country) IN ('saudi arabia', 'ksa')
);
