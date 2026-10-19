import type { SketchShapeMode } from '../../shared/geography';
import './SketchModeControl.css';

export const sketchShapeModes = [
  {
    id: 'randomized',
    letter: 'A',
    name: '最大随机',
    description:
      '完全不保留形状和大小，仅弱参考相对位置。一个小圆也可能成为大片大陆，面积、数量和群岛构成都由种子重新决定。',
  },
  {
    id: 'balanced',
    letter: 'B',
    name: '平衡生成',
    description: '参考部分轮廓，优先生成自然、多样的海陆；适合先画出大陆的大致构成。',
  },
  {
    id: 'strict',
    letter: 'C',
    name: '严格保形',
    description: '保留手绘或导入图片的海陆轮廓，仅作采样与地势整理；适合还原既定地图。',
  },
] as const;

export function SketchModeControl({
  value,
  onChange,
}: {
  value: SketchShapeMode;
  onChange: (value: SketchShapeMode) => void;
}) {
  const position = sketchShapeModes.findIndex((mode) => mode.id === value),
    current = sketchShapeModes[position];
  return (
    <fieldset className="sketch-mode-control">
      <legend>色块生成方式</legend>
      <div className="sketch-mode-track">
        <input
          type="range"
          aria-label="色块生成方式"
          aria-valuetext={`${current.letter} ${current.name}`}
          min={0}
          max={2}
          step={1}
          value={position}
          onChange={(event) => onChange(sketchShapeModes[Number(event.target.value)].id)}
        />
        <div className="sketch-mode-stops" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="sketch-mode-labels">
        {sketchShapeModes.map((mode) => (
          <button
            type="button"
            key={mode.id}
            aria-pressed={value === mode.id}
            onClick={() => onChange(mode.id)}
          >
            <b>{mode.letter}</b>
            <span>{mode.name}</span>
          </button>
        ))}
      </div>
      <p aria-live="polite">{current.description}</p>
    </fieldset>
  );
}
