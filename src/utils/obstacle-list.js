import { formatObstacleDetails, formatObstacleLabel } from './site-formatters.js';

export function renderObstacleList(container, options = {}) {
  if (!container) return;

  const {
    obstacles = [],
    selectedObstacleId = null,
    heading = null,
    note = null,
    emptyTitle = null,
    emptyMessage = null,
    highlightSelected = false,
    onSelect = null,
    onRotate = null,
    onRemove = null,
    selectedActionLabel = 'Selected',
    idleActionLabel = 'Move',
  } = options;

  container.replaceChildren();

  if (!obstacles.length) {
    if (emptyTitle || emptyMessage) {
      container.appendChild(createEmptyState(emptyTitle, emptyMessage));
    }
    return;
  }

  if (heading) {
    const headingEl = document.createElement('h4');
    headingEl.style.cssText = 'margin: 0 0 10px; font-size: 0.9rem; color: var(--text-secondary);';
    headingEl.textContent = heading;
    container.appendChild(headingEl);
  }

  if (note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'analysis-note mb-md';
    noteEl.style.marginBottom = '12px';
    noteEl.textContent = note;
    container.appendChild(noteEl);
  }

  obstacles.forEach((obstacle) => {
    const card = document.createElement('div');
    card.className = `card-flat compact-row${highlightSelected && obstacle.id === selectedObstacleId ? ' analysis-card-best' : ''}`;

    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.style.fontSize = '0.85rem';
    title.textContent = formatObstacleLabel(obstacle);

    const details = document.createElement('div');
    details.style.cssText = 'font-size: 0.75rem; color: var(--text-muted);';
    details.textContent = formatObstacleDetails(obstacle);

    info.append(title, details);

    const actions = document.createElement('div');
    actions.className = 'obstacle-action-group';

    if (typeof onSelect === 'function') {
      actions.appendChild(createActionButton({
        className: 'btn btn-sm btn-outline',
        label: obstacle.id === selectedObstacleId ? selectedActionLabel : idleActionLabel,
        onClick: () => onSelect(obstacle.id),
      }));
    }

    if (typeof onRotate === 'function' && obstacle.type === 'shed') {
      actions.appendChild(createActionButton({
        className: 'btn btn-sm btn-outline',
        label: '↺ 15°',
        onClick: () => onRotate(obstacle.id, -15),
      }));
      actions.appendChild(createActionButton({
        className: 'btn btn-sm btn-outline',
        label: '↻ 15°',
        onClick: () => onRotate(obstacle.id, 15),
      }));
    }

    if (typeof onRemove === 'function') {
      actions.appendChild(createActionButton({
        className: 'btn btn-sm btn-secondary',
        label: '✕',
        onClick: () => onRemove(obstacle.id),
      }));
    }

    card.append(info, actions);
    container.appendChild(card);
  });
}

function createActionButton({ className, label, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.style.cssText = 'padding: 4px 10px; font-size: 0.75rem;';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createEmptyState(title, message) {
  const card = document.createElement('div');
  card.className = 'card-flat card-flat-subtle';
  card.style.cssText = 'padding: 12px; margin: 0 0 14px;';

  if (title) {
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-weight: 600; margin-bottom: 4px;';
    titleEl.textContent = title;
    card.appendChild(titleEl);
  }

  if (message) {
    const messageEl = document.createElement('div');
    messageEl.style.cssText = 'font-size: 0.85rem; color: var(--text-secondary);';
    messageEl.textContent = message;
    card.appendChild(messageEl);
  }

  return card;
}
