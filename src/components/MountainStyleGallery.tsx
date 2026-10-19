import { useState } from 'react';
import { Modal } from './Common';
import { MapObjectArtwork } from './MapArtwork';
import { MOUNTAIN_STYLES, mountainTiers, type MountainTier } from '../lib/mountain-styles';
import { drawMountainPeak, projectMountainStyle } from '../lib/mountain-artwork';

export function MountainStyleGallery({ onClose }: { onClose: () => void }) {
  const [tier, setTier] = useState<MountainTier>('high');
  const styles = MOUNTAIN_STYLES.filter((style) => style.tier === tier);
  const families = [...new Set(styles.map((style) => style.family))];
  return (
    <Modal title={`山峰样式图鉴 · ${MOUNTAIN_STYLES.length} 种`} onClose={onClose} wide>
      <div className="mountain-gallery">
        <p>
          从高耸岩峰到低缓丘陵，峰形、肩部和岩脊各有变化。地图会依地势混排，并尽量避开邻近重复。
        </p>
        <div className="mountain-gallery-tabs" aria-label="山峰高度分类">
          {mountainTiers.map((group) => (
            <button
              key={group.id}
              aria-pressed={tier === group.id}
              onClick={() => setTier(group.id)}
            >
              {group.label}
              <small>32 种</small>
            </button>
          ))}
        </div>
        <p className="mountain-gallery-note">
          各档使用相同展示比例，便于比较高度。查看图鉴不会改动地图。
        </p>
        {families.map((family) => (
          <section className="mountain-gallery-family" key={family}>
            <h3>{styles.find((style) => style.family === family)!.label.split('·')[0]}</h3>
            <div className="mountain-gallery-grid">
              {styles
                .filter((style) => style.family === family)
                .map((style, index) => {
                  const peak = projectMountainStyle(
                    style,
                    { x: 100, y: 89 },
                    style.width * 2,
                    style.rise * 2,
                  );
                  const objects = drawMountainPeak(peak, 2, 527, index);
                  return (
                    <figure key={style.id} data-mountain-card={style.id}>
                      <svg viewBox="0 0 200 115" role="img" aria-label={style.label}>
                        <path d="M12 92H188" stroke="#a5926c" opacity=".12" />
                        {objects.map((object) => (
                          <MapObjectArtwork key={object.id} object={object} />
                        ))}
                      </svg>
                      <figcaption>{style.label.split('·')[1]}</figcaption>
                    </figure>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
