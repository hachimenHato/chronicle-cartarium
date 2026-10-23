export function isPrivateReleasePath(relative: string): boolean;
export function isExcludedReleaseDirectory(relative: string): boolean;
export function shouldIncludeReleasePath(relative: string): boolean;
export function createReleaseCopyFilter(root: string): (filename: string) => boolean;
export function assertPublicReleaseTree(
  root: string,
  options?: { entries?: string[] },
): Promise<{ files: number; excluded: number }>;
