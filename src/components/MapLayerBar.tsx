import {
  BookOpen,
  Mountain,
  Layers3,
  Thermometer,
  CloudRain,
  Flag,
  Users,
  Sparkles,
  Grid2X2,
  Waves,
} from 'lucide-react';
import { geographicLayerLabels, type GeographicLayer } from '../../shared/map-layers';
import './MapLayerBar.css';
const views = [
  { id: 'atlas', Icon: BookOpen, caption: '图志' },
  { id: 'terrain', Icon: Mountain, caption: '地形' },
  { id: 'elevation', Icon: Layers3, caption: '海拔' },
  { id: 'countries', Icon: Flag, caption: '国家' },
  { id: 'cultures', Icon: Users, caption: '文化' },
  { id: 'religions', Icon: Sparkles, caption: '信仰' },
  { id: 'regions', Icon: Grid2X2, caption: '区域' },
  { id: 'plates', Icon: Waves, caption: '板块' },
  { id: 'temperature', Icon: Thermometer, caption: '气温' },
  { id: 'precipitation', Icon: CloudRain, caption: '降水' },
] as const;
/** View state only: selecting a tool never chooses a layer. */
export function MapLayerBar({
  layer,
  onLayer,
  available,
  elevationAvailable,
}: {
  layer: GeographicLayer;
  onLayer: (layer: GeographicLayer) => void;
  available: boolean;
  elevationAvailable: boolean;
}) {
  return (
    <section className="map-layer-bar" aria-label="地图图层切换" data-map-layer-bar="true">
      <div className="map-layer-heading">
        <Layers3 size={17} />
        <strong>地图图层</strong>
        <span>{available ? '只改变显示，工具与创作内容保持不变' : '生成地图后开启地理图层'}</span>
      </div>
      <div className="map-layer-buttons" role="group" aria-label="地理图层">
        {views.map(({ id, Icon, caption }) => (
          <button
            key={id}
            type="button"
            aria-label={geographicLayerLabels[id]}
            title={geographicLayerLabels[id]}
            aria-pressed={layer === id}
            data-layer-button={id}
            disabled={id !== 'atlas' && !(id === 'elevation' ? elevationAvailable : available)}
            onClick={() => onLayer(id)}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{caption}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
