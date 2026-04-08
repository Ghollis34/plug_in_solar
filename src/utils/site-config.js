export const DIRECTION_OPTIONS = [
  { label: 'N', deg: 0 },
  { label: 'NE', deg: 45 },
  { label: 'E', deg: 90 },
  { label: 'SE', deg: 135 },
  { label: 'S', deg: 180 },
  { label: 'SW', deg: 225 },
  { label: 'W', deg: 270 },
  { label: 'NW', deg: 315 },
];

export const FRONT_DOOR_OPTIONS = DIRECTION_OPTIONS;
export const SHED_DIRECTION_OPTIONS = DIRECTION_OPTIONS;

export const OBSTACLE_TOOLS = [
  { id: 'fence', label: 'Fence', icon: '🟧' },
  { id: 'tree', label: 'Tree', icon: '🌳' },
  { id: 'shed', label: 'Shed / Wall', icon: '⬜' },
];

export const SPACE_TYPES = [
  { id: 'railing', icon: '🏗️', label: 'Balcony Railing' },
  { id: 'wall', icon: '🧱', label: 'Wall Mount' },
  { id: 'fence', icon: '☀️', label: 'Fence Mount' },
  { id: 'flat-roof', icon: '🏠', label: 'Flat Roof / Shed' },
  { id: 'ground', icon: '🌿', label: 'Ground / Garden' },
];

export const SPACE_TYPE_BY_ID = Object.fromEntries(
  SPACE_TYPES.map((type) => [type.id, type])
);

export const SPACE_TYPE_IDS = new Set(SPACE_TYPES.map((type) => type.id));
export const OBSTACLE_TYPE_IDS = new Set(OBSTACLE_TOOLS.map((tool) => tool.id));

export function getSpaceTypeInfo(typeId) {
  return SPACE_TYPE_BY_ID[typeId] || SPACE_TYPE_BY_ID.ground;
}
