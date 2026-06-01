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
  handle.innerHTML = '<span class="mobile-sheet-grip" aria-hidden="true"></span>';
  panel.prepend(handle);

  let collapsed = false;
  let startY = null;
  let startOffset = 0;
  let currentOffset = 0;
  let dragMoved = false;
  let touchDragActive = false;
  let lastTouchEndAt = 0;

  const getMaxOffset = () => {
    const panelHeight = panel.getBoundingClientRect().height;
    const handleHeight = handle.getBoundingClientRect().height;
    const safePeek = Math.max(handleHeight, 56);
    return Math.max(0, panelHeight - safePeek);
  };

  const setSheetContentInteractive = (interactive) => {
    [...panel.children].forEach((child) => {
      if (child === handle) return;
      if (interactive) {
        child.removeAttribute('aria-hidden');
        child.inert = false;
      } else {
        child.setAttribute('aria-hidden', 'true');
        child.inert = true;
      }
    });
  };

  const queueResize = () => {
    window.requestAnimationFrame(() => {
      options.onToggle?.({ collapsed });
    });
  };

  const setCollapsed = (nextCollapsed, updateOptions = {}) => {
    collapsed = Boolean(nextCollapsed);
    panel.style.removeProperty('--mobile-sheet-drag-offset');
    page.classList.remove('mobile-sheet-dragging');
    page.classList.toggle('mobile-sheet-collapsed', collapsed);
    page.classList.toggle('mobile-sheet-expanded', !collapsed);
    handle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    handle.setAttribute(
      'aria-label',
      collapsed ? 'Open map controls' : 'Hide map controls'
    );
    setSheetContentInteractive(!collapsed);

    if (updateOptions.notify !== false) {
      queueResize();
    }
  };

  const applyDragOffset = (offset) => {
    currentOffset = Math.min(Math.max(offset, 0), getMaxOffset());
    panel.style.setProperty('--mobile-sheet-drag-offset', `${currentOffset}px`);
  };

  const beginDrag = (clientY) => {
    startY = clientY;
    startOffset = collapsed ? getMaxOffset() : 0;
    currentOffset = startOffset;
    dragMoved = false;
    page.classList.add('mobile-sheet-dragging');
    panel.style.setProperty('--mobile-sheet-drag-offset', `${startOffset}px`);
  };

  const moveDrag = (clientY) => {
    if (startY == null) return false;

    const deltaY = clientY - startY;
    if (Math.abs(deltaY) > 4) {
      dragMoved = true;
    }

    applyDragOffset(startOffset + deltaY);
    return true;
  };

  const endDrag = () => {
    if (startY == null) return false;

    const maxOffset = getMaxOffset();
    const shouldCollapse = currentOffset > maxOffset * 0.45;
    const wasMoved = dragMoved;

    startY = null;

    if (wasMoved) {
      setCollapsed(shouldCollapse);
      return true;
    }

    page.classList.remove('mobile-sheet-dragging');
    panel.style.removeProperty('--mobile-sheet-drag-offset');
    return false;
  };

  const cancelDrag = () => {
    startY = null;
    dragMoved = false;
    setCollapsed(collapsed, { notify: false });
  };

  const handlePointerDown = (event) => {
    if (touchDragActive) return;
    beginDrag(event.clientY);
    handle.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (touchDragActive) return;
    if (moveDrag(event.clientY)) {
      event.preventDefault();
    }
  };

  const handlePointerUp = (event) => {
    if (touchDragActive) return;
    handle.releasePointerCapture?.(event.pointerId);
    endDrag();
  };

  const handlePointerCancel = () => {
    if (touchDragActive) return;
    cancelDrag();
  };

  const handleTouchStart = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    touchDragActive = true;
    beginDrag(touch.clientY);
  };

  const handleTouchMove = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    if (moveDrag(touch.clientY)) {
      event.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    const wasTap = !endDrag();
    lastTouchEndAt = Date.now();
    touchDragActive = false;
    if (wasTap) {
      setCollapsed(!collapsed);
    }
  };

  const handleTouchCancel = () => {
    touchDragActive = false;
    cancelDrag();
  };

  const handleClick = () => {
    if (Date.now() - lastTouchEndAt < 500) {
      return;
    }
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    setCollapsed(!collapsed);
  };

  handle.addEventListener('pointerdown', handlePointerDown);
  handle.addEventListener('pointermove', handlePointerMove);
  handle.addEventListener('pointerup', handlePointerUp);
  handle.addEventListener('pointercancel', handlePointerCancel);
  handle.addEventListener('touchstart', handleTouchStart, { passive: false });
  handle.addEventListener('touchmove', handleTouchMove, { passive: false });
  handle.addEventListener('touchend', handleTouchEnd);
  handle.addEventListener('touchcancel', handleTouchCancel);
  handle.addEventListener('click', handleClick);

  setCollapsed(Boolean(options.collapsed), { notify: false });

  return {
    setCollapsed,
    isCollapsed: () => collapsed,
    destroy: () => {
      page.classList.remove('mobile-sheet-collapsed', 'mobile-sheet-expanded', 'mobile-sheet-dragging');
      panel.style.removeProperty('--mobile-sheet-drag-offset');
      setSheetContentInteractive(true);
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
