/* The display currency (currency spec §3). A label and a number of decimals only: amounts are
   never converted, they stay integer thousandths of the unit (`Mil`). Adding a currency is one
   entry here plus the SQL check list in the currency migration. */

export const CURRENCY_CODES = ['TND', 'EUR', 'USD', 'GBP', 'CAD', 'CHF', 'MAD', 'DZD', 'LYD'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface Currency {
  code: CurrencyCode;
  /** French name, for server text (Aam Salah); the UI reads `currency.name.<code>` in fr.json. */
  name: string;
  /** Shown after the figure, after a no-break space. */
  suffix: string;
  decimals: 2 | 3;
  /** What else a person may type after an amount (lower case; the suffix and code are implied). */
  aliases: string[];
  /** IANA time zones that suggest this currency at onboarding. */
  zones: string[];
}

export const CURRENCIES: readonly Currency[] = [
  {
    code: 'TND',
    name: 'Dinar tunisien',
    suffix: 'TND',
    decimals: 3,
    aliases: ['dt', 'dinar', 'dinars'],
    zones: ['Africa/Tunis'],
  },
  {
    code: 'EUR',
    name: 'Euro',
    suffix: '€',
    decimals: 2,
    aliases: ['euro', 'euros'],
    zones: [
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Madrid',
      'Europe/Rome',
      'Europe/Brussels',
      'Europe/Amsterdam',
      'Europe/Luxembourg',
      'Europe/Monaco',
      'Europe/Vienna',
      'Europe/Lisbon',
      'Europe/Dublin',
      'Europe/Athens',
      'Europe/Helsinki',
      'Europe/Tallinn',
      'Europe/Riga',
      'Europe/Vilnius',
      'Europe/Bratislava',
      'Europe/Ljubljana',
      'Europe/Zagreb',
      'Europe/Malta',
      'Europe/Andorra',
      'Europe/San_Marino',
      'Europe/Vatican',
      'Asia/Nicosia',
      'Europe/Nicosia',
      'Atlantic/Madeira',
      'Atlantic/Canary',
      'Atlantic/Azores',
      'Africa/Ceuta',
      'Indian/Reunion',
      'Indian/Mayotte',
      'America/Guadeloupe',
      'America/Martinique',
      'America/Cayenne',
      'America/St_Barthelemy',
      'America/Marigot',
      'America/Miquelon',
    ],
  },
  {
    code: 'USD',
    name: 'Dollar américain',
    suffix: '$',
    decimals: 2,
    aliases: ['dollar', 'dollars'],
    zones: [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Phoenix',
      'America/Anchorage',
      'America/Detroit',
      'America/Boise',
      'America/Juneau',
      'America/Indiana/Indianapolis',
      'America/Kentucky/Louisville',
      'Pacific/Honolulu',
      'America/Puerto_Rico',
    ],
  },
  {
    code: 'GBP',
    name: 'Livre sterling',
    suffix: '£',
    decimals: 2,
    aliases: ['livre', 'livres'],
    zones: ['Europe/London', 'Europe/Belfast'],
  },
  {
    code: 'CAD',
    name: 'Dollar canadien',
    suffix: '$ CA',
    decimals: 2,
    aliases: ['$ca', '$'],
    zones: [
      'America/Toronto',
      'America/Montreal',
      'America/Vancouver',
      'America/Edmonton',
      'America/Winnipeg',
      'America/Halifax',
      'America/St_Johns',
      'America/Regina',
      'America/Moncton',
      'America/Whitehorse',
      'America/Yellowknife',
      'America/Iqaluit',
    ],
  },
  {
    code: 'CHF',
    name: 'Franc suisse',
    suffix: 'CHF',
    decimals: 2,
    aliases: ['franc', 'francs'],
    zones: ['Europe/Zurich', 'Europe/Vaduz'],
  },
  {
    code: 'MAD',
    name: 'Dirham marocain',
    suffix: 'DH',
    decimals: 2,
    aliases: ['dirham', 'dirhams'],
    zones: ['Africa/Casablanca', 'Africa/El_Aaiun'],
  },
  {
    code: 'DZD',
    name: 'Dinar algérien',
    suffix: 'DA',
    decimals: 2,
    aliases: ['dinar', 'dinars'],
    zones: ['Africa/Algiers'],
  },
  {
    code: 'LYD',
    name: 'Dinar libyen',
    suffix: 'LYD',
    decimals: 3,
    aliases: ['ld', 'dinar', 'dinars'],
    zones: ['Africa/Tripoli'],
  },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));
const TND = BY_CODE.get('TND') as Currency;

export function isCurrencyCode(x: unknown): x is CurrencyCode {
  return typeof x === 'string' && BY_CODE.has(x as CurrencyCode);
}

/** The currency for a stored code; TND for an unknown or missing one (a newer code, a corrupt row). */
export function currencyOf(code: string | null | undefined): Currency {
  return (isCurrencyCode(code) && BY_CODE.get(code)) || TND;
}

/** The onboarding suggestion, from the device time zone (not the language: Tunisian phones often run fr-FR). */
export function guessCurrency(timeZone: string): CurrencyCode {
  return CURRENCIES.find((c) => c.zones.includes(timeZone))?.code ?? 'TND';
}

/** The device's IANA time zone ('' when the browser won't say). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}
