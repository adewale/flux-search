import { KNOWN_ENTITIES } from './known-entities';

export type TopicType = 'theme' | 'technology' | 'person' | 'place' | 'publication' | 'book' | 'organization' | 'event' | 'unknown';
export type TopicStatus = 'allow' | 'deny' | 'review';

export interface TopicRegistryEntry {
  canonical: string;
  display: string;
  aliases: string[];
  topicType: TopicType;
  status: TopicStatus;
  notes?: string;
}

export interface TopicRegistry {
  entries: Map<string, TopicRegistryEntry>;
  aliases: Map<string, string>;
}

const TYPE_OVERRIDES: Record<string, TopicType> = {
  crypto: 'technology',
  cryptocurrency: 'technology',
  'large language models': 'technology',
  'machine learning': 'technology',
  'open source': 'technology',
  web3: 'technology',
  'rest of world': 'publication',
  'not boring': 'publication',
  'crooked timber': 'publication',
  'new york times': 'publication',
  'scientific american': 'publication',
  'simple habits for complex times': 'book',
  'seeing like a state': 'book',
  'ursula k. le guin': 'person',
  'christopher alexander': 'person',
  'venkatesh rao': 'person',
  'systems thinking': 'theme',
  'mental models': 'theme',
  'climate change': 'theme',
  legibility: 'theme',
  governance: 'theme',
  attention: 'theme',
  awareness: 'theme',
  judgment: 'theme',
  exploration: 'theme',
  iteration: 'theme',
  prompting: 'theme',
  zugzwang: 'theme',
  'saddle point': 'theme',
};

const DENY: Array<[string, string]> = [
  ['img src', 'markup artifact'],
  ['xers highlighting', 'editorial artifact'],
  ['fluxers highlighting', 'editorial artifact'],
  ['exchange commission', 'malformed fragment'],
  ['secretary of defense rock', 'malformed fragment'],
  ['many americans', 'generic phrase'],
  ['as treasury', 'clause fragment'],
  ['good reason you can', 'clause fragment'],
  ['biggest film bombed', 'malformed phrase'],
];

let cached: TopicRegistry | null = null;

function normalize(s: string): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function getTopicRegistry(): TopicRegistry {
  if (cached) return cached;
  const entries = new Map<string, TopicRegistryEntry>();
  const aliases = new Map<string, string>();

  for (const entity of KNOWN_ENTITIES) {
    const canonical = normalize(entity.canonical);
    const entry: TopicRegistryEntry = {
      canonical,
      display: entity.display,
      aliases: entity.aliases.map(normalize),
      topicType: TYPE_OVERRIDES[canonical] ?? 'unknown',
      status: 'allow',
    };
    entries.set(canonical, entry);
    aliases.set(canonical, canonical);
    for (const alias of entry.aliases) aliases.set(alias, canonical);
  }

  for (const [keyword, notes] of DENY) {
    const canonical = normalize(keyword);
    const entry: TopicRegistryEntry = {
      canonical,
      display: keyword,
      aliases: [canonical],
      topicType: 'unknown',
      status: 'deny',
      notes,
    };
    entries.set(canonical, entry);
    aliases.set(canonical, canonical);
  }

  cached = { entries, aliases };
  return cached;
}

export function lookupTopicRegistry(surface: string, registry = getTopicRegistry()): TopicRegistryEntry | null {
  const normalized = normalize(surface);
  const canonical = registry.aliases.get(normalized) ?? normalized;
  return registry.entries.get(canonical) ?? null;
}
