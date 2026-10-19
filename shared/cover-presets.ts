/** Public bundled illustrations, deliberately separate from private uploaded assets. */
export const coverPresets = [
  {
    id: 'moon-town',
    name: '月夜城镇',
    description: '灯火、河岸与月下屋檐，适合城镇和国家。',
    url: '/covers/moon-town.png',
  },
  {
    id: 'elder-forest',
    name: '古老森林',
    description: '古木、幽径与林中圣所，适合荒野和信仰。',
    url: '/covers/elder-forest.png',
  },
  {
    id: 'astral-tower',
    name: '星辉高塔',
    description: '群星、观测仪与山巅高塔，适合魔法和学派。',
    url: '/covers/astral-tower.png',
  },
  {
    id: 'lost-ruins',
    name: '失落遗迹',
    description: '残垣、藤蔓与晨雾，适合历史和古老遗物。',
    url: '/covers/lost-ruins.png',
  },
] as const;
export function isPresetCover(url: string): boolean {
  return coverPresets.some((preset) => preset.url === url);
}
