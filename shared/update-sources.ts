import sources from './update-sources.json' with { type: 'json' };
import type { OnlineUpdateSettingsInput, OnlineUpdateSource } from './update';

/** Public download locations only. Credentials never belong in application settings. */
export const UPDATE_SOURCES = sources;

type SourceSelection = Pick<OnlineUpdateSettingsInput, 'source' | 'mirrorBaseUrl'> &
  Partial<Pick<OnlineUpdateSettingsInput, 'channel'>>;

/** Recognize the preset without extending the protocol understood by older shells. */
export function updateSourceChoice(settings: SourceSelection): OnlineUpdateSource {
  if (
    settings.source === 'china' ||
    (settings.source === 'mirror' &&
      settings.mirrorBaseUrl?.replace(/\/+$/, '') === UPDATE_SOURCES.china.baseUrl)
  )
    return 'china';
  return settings.source;
}

export function updateSourceLabel(
  source: OnlineUpdateSource | SourceSelection,
  mirrorBaseUrl?: string,
): string {
  const choice = updateSourceChoice(
    typeof source === 'string' ? { source, mirrorBaseUrl } : source,
  );
  return UPDATE_SOURCES[choice].label;
}

/** Built-in sources cannot be redirected by a caller-supplied custom mirror address. */
export function updateMirrorBaseUrl(settings: SourceSelection): string | undefined {
  if (settings.source === 'china') return UPDATE_SOURCES.china.baseUrl;
  return settings.source === 'mirror' ? settings.mirrorBaseUrl : undefined;
}
