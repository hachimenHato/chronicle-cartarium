import keys from './release-trust.json' with { type: 'json' };
/** The same public trust source is used by Node and the desktop bootstrap. */
export const releasePublicKeys: Record<string, string> = keys;
