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
  {
    id: 'fence',
    label: 'Fence or boundary',
    icon: '🟧',
    actionLabel: 'Mark a straight fence line',
    helpText: 'Use this for a fence or side boundary that may shade the panel area. Tap the start and end of one straight section.',
  },
  {
    id: 'tree',
    label: 'Tree shade',
    icon: '🌳',
    actionLabel: 'Mark a tree',
    helpText: 'Use this for trees that could cast shade. Approximate size is fine — this step is optional.',
  },
  {
    id: 'shed',
    label: 'Shed, wall or outbuilding',
    icon: '⬜',
    actionLabel: 'Mark a shed or wall',
    helpText: 'Use this for a shed, garage, high wall, or outbuilding near the panel area. Approximate the footprint if you are not sure.',
  },
];

export const SPACE_TYPES = [
  {
    id: 'railing',
    icon: '🏗️',
    label: 'Balcony or railing',
    description: 'For flats, balconies, terraces, or railings where panels cannot go on a roof or garden frame.',
    actionLabel: 'Choose balcony or railing location',
  },
  {
    id: 'wall',
    icon: '🧱',
    label: 'Outside wall',
    description: 'For panels fixed vertically or on angled brackets to an outside house, garage, or garden wall.',
    actionLabel: 'Choose wall location',
  },
  {
    id: 'fence',
    icon: '☀️',
    label: 'Fence or boundary',
    description: 'For panels attached to a strong fence or boundary frame, usually facing into the garden.',
    actionLabel: 'Choose fence location',
  },
  {
    id: 'flat-roof',
    icon: '🏠',
    label: 'Shed or flat roof',
    description: 'For panels on a garage, shed, extension, or other mostly flat roof area using a small frame.',
    actionLabel: 'Choose roof location',
  },
  {
    id: 'ground',
    icon: '🌿',
    label: 'Garden or patio',
    description: 'For panels on a small ground frame in a garden, patio, yard, or other open outdoor space.',
    actionLabel: 'Choose garden or patio location',
  },
];

export const SPACE_TYPE_BY_ID = Object.fromEntries(
  SPACE_TYPES.map((type) => [type.id, type])
);

export const SPACE_TYPE_IDS = new Set(SPACE_TYPES.map((type) => type.id));
export const OBSTACLE_TYPE_IDS = new Set(OBSTACLE_TOOLS.map((tool) => tool.id));

export function getSpaceTypeInfo(typeId) {
  return SPACE_TYPE_BY_ID[typeId] || SPACE_TYPE_BY_ID.ground;
}
