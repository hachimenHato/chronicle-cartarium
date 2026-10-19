export type GeographicLayer =
  | 'atlas'
  | 'terrain'
  | 'elevation'
  | 'plates'
  | 'temperature'
  | 'precipitation'
  | 'regions'
  | 'countries'
  | 'cultures'
  | 'religions';
export const geographicLayerLabels: Record<GeographicLayer, string> = {
  atlas: '古典图志',
  terrain: '地貌',
  elevation: '海拔地势',
  plates: '板块与大陆架',
  temperature: '年均气温',
  precipitation: '年降水',
  regions: '基础区域',
  countries: '国家势力',
  cultures: '文化分布',
  religions: '信仰分布',
};
