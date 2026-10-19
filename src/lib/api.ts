import type { Workspace, WorkspaceEnvelope } from '../../shared/model';
import { APPLICATION_VERSION } from '../../shared/application';
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'X-Chronicle-Cartarium-Client': APPLICATION_VERSION,
      'X-Worldloom-Client': APPLICATION_VERSION,
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw Object.assign(
      new Error(
        typeof error.message === 'string'
          ? error.message
          : typeof error.error === 'string'
            ? error.error
            : '请求失败',
      ),
      { status: response.status },
    );
  }
  return response.json();
}
export const getWorkspace = () => request<WorkspaceEnvelope>('/api/workspace');
export const saveWorkspace = (data: Workspace, revision: number) =>
  request<WorkspaceEnvelope>('/api/workspace', {
    method: 'PUT',
    body: JSON.stringify({ data, revision }),
  });
export function downloadFile(name: string, content: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
