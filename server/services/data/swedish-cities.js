// ============================================================
// V9 Pipeline — Svenska städer (Fas 3 Swedish Gate)
// ============================================================
// Topp 50 svenska städer med >15 000 invånare.
// Källa: Wikipedia "List of cities in Sweden by population".
// Täcker ~88% av Sveriges befolkning.

const CITIES = [
  'Stockholm', 'Göteborg', 'Goteborg', 'Malmö', 'Malmo', 'Uppsala', 'Västerås',
  'Vasteras', 'Örebro', 'Orebro', 'Linköping', 'Linkoping', 'Helsingborg',
  'Jönköping', 'Jonkoping', 'Norrköping', 'Norrkoping', 'Lund', 'Umeå', 'Umea',
  'Gävle', 'Gavle', 'Borås', 'Boras', 'Eskilstuna', 'Södertälje', 'Sodertalje',
  'Karlstad', 'Täby', 'Taby', 'Växjö', 'Vaxjo', 'Halmstad', 'Sundsvall',
  'Luleå', 'Lulea', 'Trollhättan', 'Trollhattan', 'Östersund', 'Ostersund',
  'Borlänge', 'Borlange', 'Tumba', 'Upplands Väsby', 'Upplands Vasby', 'Falun',
  'Kalmar', 'Skövde', 'Skovde', 'Karlskrona', 'Kristianstad', 'Sollentuna',
  'Varberg', 'Lidingö', 'Lidingo', 'Skellefteå', 'Skelleftea', 'Nyköping',
  'Nykoping', 'Norrtälje', 'Norrtalje', 'Mölndal', 'Molndal', 'Visby',
  'Sandviken', 'Värnamo', 'Varnamo', 'Motala', 'Trelleborg', 'Ängelholm',
  'Angelholm', 'Vänersborg', 'Vanersborg', 'Märsta', 'Marsta', 'Alingsås',
  'Alingsas', 'Piteå', 'Pitea', 'Köping', 'Koping', 'Enköping', 'Enkoping',
  'Härnösand', 'Harnosand', 'Lerum', 'Karlskoga', 'Sigtuna', 'Falkenberg',
  'Landskrona', 'Sandviken', 'Hässleholm', 'Hassleholm', 'Ystad',
];

// Normalisera till lowercase Set (med åäö varianter)
export const SWEDISH_CITIES = new Set(CITIES.map(c => c.toLowerCase()));

/**
 * Kollar om text innehåller en svensk stad (whole-word match).
 */
export function containsSwedishCity(text) {
  if (!text) return false;
  const lc = text.toLowerCase();
  for (const city of SWEDISH_CITIES) {
    // Word boundary check via simple regex (city kan innehålla space)
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(lc)) return true;
  }
  return false;
}
