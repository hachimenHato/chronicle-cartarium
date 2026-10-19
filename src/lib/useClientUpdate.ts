import { useEffect, useState } from 'react';

/** A missing manifest or a temporarily unavailable deployment is not an app error. */
export async function fetchClientBuild(fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  try {
    const response = await fetcher('/app-version.json', { cache: 'no-store', signal });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
      return undefined;
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== 'object' ||
      !('buildId' in value) ||
      typeof value.buildId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(value.buildId)
    )
      return undefined;
    return value.buildId;
  } catch {
    return undefined;
  }
}

export function useClientUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    const currentBuild = (
      document.querySelector<HTMLMetaElement>('meta[name="chronicle-cartarium-build"]') ||
      document.querySelector<HTMLMetaElement>('meta[name="worldloom-build"]')
    )?.content;
    // Vite's development page has no build marker and is managed by HMR instead.
    if (!currentBuild) return;
    let alive = true;
    let pending = false;
    let controller: AbortController | undefined;
    const check = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 10_000);
      const remoteBuild = await fetchClientBuild(fetch, controller.signal);
      window.clearTimeout(timeout);
      pending = false;
      if (alive && remoteBuild) setUpdateAvailable(remoteBuild !== currentBuild);
    };
    void check();
    const interval = window.setInterval(() => void check(), 60_000);
    const onVisible = () => void check();
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return updateAvailable;
}
