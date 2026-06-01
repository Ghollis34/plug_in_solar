export function setupMobileControlSheet(options = {}) {
  const page = document.querySelector(options.pageSelector || '.step-page-map');
  const panel = page?.querySelector(options.panelSelector || '.map-overlay-panel');

  if (!page || !panel) {
    return createNoopSheetController();
  }

  panel.classList.add('mobile-control-sheet');

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'mobile-sheet-handle';
  handle.setAttribute('aria-controls', panel.id || 'mobile-map-controls');
  panel.prepend(handle);

  let collapsed = false;
  let startY = null;
  let moved = false;

  const setCollapsed = (nextCollapsed, updateOptions = {}) => {
    collapsed = Boolean(nextCollapsed);
    page.classList.toggle('mobile-sheet-collapsed', collapsed);
    page.classList.toggle('mobile-sheet-expanded', !collapsed);
    handle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    handle.setAttribute(
      'aria-label',
      collapsed ? 'Open map controls' : 'Hide map controls'
    );
    handle.innerHTML = collapsed
      ? '<span class="mobile-sheet-grip" aria-hidden="true"></span><span>Controls</span><small>Drag up</small>'
      : '<span class="mobile-sheet-grip" aria-hidden="true"></span><span>Hide controls</span><small>Drag down</small>';

    if (updateOptions.notify !== false) {
      options.onToggle?.({ collapsed });
    }
  };

  const handlePointerDown = (event) => {
    startY = event.clientY;
    moved = false;
    handle.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (startY == null) return;
    if (Math.abs(event.clientY - startY) > 10) {
      moved = true;
    }
  };

  const handlePointerUp = (event) => {
    if (startY == null) return;
    const deltaY = event.clientY - startY;
    startY = null;
    handle.releasePointerCapture?.(event.pointerId);

    if (Math.abs(deltaY) < 28) {
      return;
    }

    setCollapsed(deltaY > 0);
  };

  const handleClick = () => {
    if (moved) {
      moved = false;
      return;
    }
    setCollapsed(!collapsed);
  };

  handle.addEventListener('pointerdown', handlePointerDown);
  handle.addEventListener('pointermove', handlePointerMove);
  handle.addEventListener('pointerup', handlePointerUp);
  handle.addEventListener('pointercancel', () => {
    startY = null;
    moved = false;
  });
  handle.addEventListener('click', handleClick);

  setCollapsed(Boolean(options.collapsed), { notify: false });

  return {
    setCollapsed,
    isCollapsed: () => collapsed,
    destroy: () => {
      page.classList.remove('mobile-sheet-collapsed', 'mobile-sheet-expanded');
      panel.classList.remove('mobile-control-sheet');
      handle.remove();
    },
  };
}

function createNoopSheetController() {
  return {
    setCollapsed: () => {},
    isCollapsed: () => false,
    destroy: () => {},
  };
}
