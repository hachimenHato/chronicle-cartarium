import { useState } from 'react';
import { Check, Image } from 'lucide-react';
import { coverPresets } from '../../shared/cover-presets';
import { Modal } from './Common';

export function CoverPresets({
  value,
  onChoose,
}: {
  value?: string;
  onChoose: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(value);
  return (
    <>
      <button
        className="btn cover-preset-open"
        type="button"
        onClick={() => {
          setSelected(value ?? coverPresets[0].url);
          setOpen(true);
        }}
      >
        <Image size={15} /> 选择预设封面
      </button>
      {open && (
        <Modal title="预设封面" onClose={() => setOpen(false)} wide>
          <p className="muted">选择一张作为封面；也可以随时上传自己的图片。保存条目后生效。</p>
          <div className="cover-preset-grid">
            {coverPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`cover-preset-card ${selected === preset.url ? 'selected' : ''}`}
                aria-pressed={selected === preset.url}
                aria-label={`预览${preset.name}`}
                onClick={() => setSelected(preset.url)}
              >
                <img src={preset.url} alt={preset.name} loading="lazy" />
                <span className="cover-preset-title">
                  <strong>{preset.name}</strong>
                  {selected === preset.url && <Check size={17} />}
                </span>
                <small>{preset.description}</small>
              </button>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setOpen(false)}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={!selected}
              onClick={() => {
                if (selected) onChoose(selected);
                setOpen(false);
              }}
            >
              使用此封面
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
