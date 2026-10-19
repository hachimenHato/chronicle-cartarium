import type { PublishedRecord } from '../../shared/model';
import type { ContentModule } from '../../shared/access';
import { useAccess } from './AccessContext';
export function RecordPublication({
  module,
  record,
  onChange,
}: {
  module: ContentModule;
  record: PublishedRecord & { id: string };
  onChange: (visibility: 'public' | 'gm') => void;
}) {
  const access = useAccess();
  return (
    <label className="publication-control">
      可见范围
      <select
        aria-label="创作内容可见范围"
        value={record.visibility ?? 'gm'}
        disabled={!access.update(module, record)}
        onChange={(e) => onChange(e.target.value as 'public' | 'gm')}
      >
        <option value="gm">GM 私密 / 单独授权</option>
        <option value="public">公开 · 普通用户可查看</option>
      </select>
    </label>
  );
}
