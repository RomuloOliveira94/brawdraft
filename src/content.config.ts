import { defineCollection, z } from 'astro:content';
import { file } from 'astro/loaders';

const brawlerClass = z.enum([
  'Artillery', 'Assassin', 'Controller', 'Damage Dealer',
  'Marksman', 'Support', 'Tank', 'Unknown',
]);

const brawlers = defineCollection({
  loader: file('src/data/brawlers.json'),
  schema: z.object({
    id: z.string(),
    brawlerId: z.number().int(),
    name: z.string(),
    className: brawlerClass,
    rarity: z.string(),
    rarityColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    released: z.boolean(),
    image: z.string().startsWith('/brawlers/'),
    counters: z.array(z.object({
      slug: z.string().min(1),
      rank: z.number().int().min(1).max(3),
      note: z.string().optional(),
    })).max(3),
    hasCounters: z.boolean(),
    counterFor: z.array(z.string()),
    maps: z.array(z.object({ mapId: z.string(), category: z.string() })),
    aliases: z.array(z.string()),
  }),
});

const maps = defineCollection({
  loader: file('src/data/maps.json'),
  schema: z.object({
    id: z.string(), name: z.string(), namePt: z.string(),
    mapApiId: z.number().int(),
    image: z.string().startsWith('/maps/'),
    environment: z.string(),
    link: z.string().url(),
    gameMode: z.object({
      name: z.string(),
      color: z.string(),
      bgColor: z.string(),
      image: z.string().startsWith('/game-modes/'),
    }),
    tips: z.array(z.string()),
    categories: z.array(z.object({
      key: z.string(), label: z.string(),
      brawlers: z.array(z.string()).min(1),
    })),
  }),
});

export const collections = { brawlers, maps };
