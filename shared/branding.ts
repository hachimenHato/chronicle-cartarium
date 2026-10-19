import brand from './brand.json';

export const BRAND_ZH = brand.nameZh;
export const BRAND_EN = brand.nameEn;
export const BRAND_SLUG = brand.slug;
export const BRAND_INITIALS = brand.initials;
export const BRAND_TITLE = `${BRAND_ZH} ${BRAND_EN}`;
export const BRAND_EYEBROW = BRAND_EN.toUpperCase();
// Public display aliases only. Saved credentials, custom names and data are never rewritten.
const legacyDefaultTitles = new Set(['织界 Worldloom', '织界', '纺界', 'Worldloom']);
export function displayApplicationTitle(title: string): string {
  return legacyDefaultTitles.has(title) ? BRAND_TITLE : title;
}
export function shortApplicationTitle(title: string): string {
  const normalized = displayApplicationTitle(title);
  return normalized === BRAND_TITLE ? BRAND_ZH : normalized;
}
export const CREATIVE_BACKUP_FORMAT = BRAND_SLUG;
export const LEGACY_CREATIVE_BACKUP_FORMAT = 'worldloom';
export function isCreativeBackupFormat(value: unknown): boolean {
  return value === CREATIVE_BACKUP_FORMAT || value === LEGACY_CREATIVE_BACKUP_FORMAT;
}
export const UPDATE_PACKAGE_EXTENSION = '.ccupdate';
export const PRIVATE_BACKUP_EXTENSION = '.ccbackup';
export const DATABASE_PREFIX = 'chronicle_cartarium_';
// Legacy project names remain valid so old installations and recovery tools can still work.
export const DATABASE_NAME_PATTERN =
  '(?:chronicle_cartarium_[a-zA-Z0-9_]{3,45}|worldloom_[a-zA-Z0-9_]{3,55})';
export function validProjectDatabaseName(name: string): boolean {
  return new RegExp(`^${DATABASE_NAME_PATTERN}$`).test(name);
}
