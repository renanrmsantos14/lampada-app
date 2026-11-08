// Atualização pelo GitHub Releases: procura o APK mais novo, baixa e abre o instalador do Android.
import { Directory, File, Paths } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { useCallback, useState } from 'react';
import { BUILD } from './build-info';

export const REPO = 'renanrmsantos14/lampada-app';
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export type Release = { version: string; url: string };

export type UpdateState =
  | { status: 'idle' | 'checking' | 'latest' }
  | { status: 'available'; release: Release }
  | { status: 'downloading'; release: Release; progress: number }
  | { status: 'error'; message: string; release?: Release };

const parts = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);

export function isNewer(candidate: string, current: string): boolean {
  const [a, b] = [parts(candidate), parts(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

async function latestRelease(): Promise<Release> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  const json = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
  const apk = json.assets.find((a) => a.name.endsWith('.apk'));
  if (!apk) throw new Error('A última versão não tem APK');
  return { version: json.tag_name.replace(/^v/, ''), url: apk.browser_download_url };
}

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  const check = useCallback(async () => {
    setState({ status: 'checking' });
    try {
      const release = await latestRelease();
      setState(isNewer(release.version, BUILD.version) ? { status: 'available', release } : { status: 'latest' });
    } catch (e) {
      setState({ status: 'error', message: `Não consegui verificar: ${(e as Error).message}` });
    }
  }, []);

  const install = useCallback(async (release: Release) => {
    setState({ status: 'downloading', release, progress: 0 });
    try {
      const dir = new Directory(Paths.cache, 'updates');
      dir.create({ idempotent: true, intermediates: true });
      const apk = await File.downloadFileAsync(release.url, new File(dir, `lampada-${release.version}.apk`), {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) =>
          totalBytes > 0 && setState({ status: 'downloading', release, progress: bytesWritten / totalBytes }),
      });
      setState({ status: 'available', release });
      await startActivityAsync('android.intent.action.VIEW', {
        data: apk.contentUri,
        type: 'application/vnd.android.package-archive',
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      });
    } catch (e) {
      setState({ status: 'error', release, message: `Falha ao baixar: ${(e as Error).message}` });
    }
  }, []);

  return { state, check, install };
}
