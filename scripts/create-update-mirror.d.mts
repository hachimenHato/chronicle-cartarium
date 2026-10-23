export interface PublicMirrorAsset {
  name: string;
  size: number;
  digest: string;
  browser_download_url: string;
  state: 'uploaded';
}
export interface PublicMirrorRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  draft: false;
  prerelease: boolean;
  published_at: string;
  assets: PublicMirrorAsset[];
}
export function publicRelease(
  value: unknown,
): { version: string; release: PublicMirrorRelease } | undefined;
export function createUpdateMirror(options: {
  catalog: string;
  packages: string;
  output: string;
}): Promise<{ releases: number; packages: number }>;
