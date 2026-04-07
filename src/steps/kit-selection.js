import kitsData from '../data/kits.json';
import { getState, setState } from '../utils/state.js';

let activeFilters = { wattage: 'all', battery: 'all', brand: 'all' };

export function render() {
  const selectedKit = getState('selectedKit');
  
  return `
    <div class="step-page scrollable">
      <div class="step-header">
        <h2 class="step-title">🔋 Choose Your Kit</h2>
        <p class="step-subtitle">Compare plug-in solar kits from top UK brands</p>
      </div>

      <div class="step-body">
        <div class="kit-filters" id="kit-filters">
          <button class="filter-chip active" data-filter="wattage" data-value="all">All Sizes</button>
          <button class="filter-chip" data-filter="wattage" data-value="small">≤400W</button>
          <button class="filter-chip" data-filter="wattage" data-value="large">700W+</button>
          <span style="color: var(--border); padding: 0 4px;">|</span>
          <button class="filter-chip active" data-filter="battery" data-value="all">All Types</button>
          <button class="filter-chip" data-filter="battery" data-value="no">No Battery</button>
          <button class="filter-chip" data-filter="battery" data-value="yes">With Battery</button>
          <span style="color: var(--border); padding: 0 4px;">|</span>
          <button class="filter-chip active" data-filter="brand" data-value="all">All Brands</button>
          ${[...new Set(kitsData.map(k => k.brand))].map(b => `
            <button class="filter-chip" data-filter="brand" data-value="${b}">${b}</button>
          `).join('')}
        </div>

        <div class="kits-grid" id="kits-grid">
          ${renderKits(kitsData, selectedKit?.id)}
        </div>
      </div>

      <div class="step-footer">
        <button class="btn btn-secondary" id="btn-back-kits">← Back</button>
        <button class="btn btn-primary" id="btn-next-kits" ${selectedKit ? '' : 'disabled'}>
          Continue →
        </button>
      </div>
    </div>
  `;
}

function renderKits(kits, selectedId) {
  if (kits.length === 0) {
    return `
      <div class="loading-overlay">
        <p>No kits match your filters. Try adjusting them.</p>
      </div>
    `;
  }

  const spaces = getState('spaces') || [];
  const spaceTypes = spaces.map(s => s.type);

  return kits.map(kit => {
    const isSelected = kit.id === selectedId;
    const isCompatible = kit.mountingTypes.some(mt => spaceTypes.includes(mt)) || spaceTypes.length === 0;
    
    return `
      <div class="card kit-card ${isSelected ? 'selected' : ''}" data-kit-id="${kit.id}" id="kit-${kit.id}">
        <div class="kit-select-badge">✓ Selected</div>
        <div class="kit-card-image">
          <span style="font-size: 3rem;">☀️</span>
        </div>
        <div class="kit-card-body">
          <div class="kit-brand">${kit.brand}</div>
          <h3 class="kit-name">${kit.name}</h3>
          <p class="kit-desc">${kit.description}</p>
          
          <div class="kit-specs">
            <span class="kit-spec-tag highlight">${kit.wattage}W</span>
            <span class="kit-spec-tag">${kit.panelCount} panel${kit.panelCount > 1 ? 's' : ''}</span>
            <span class="kit-spec-tag">${kit.weightKg}kg</span>
            <span class="kit-spec-tag">${kit.warrantyYears}yr warranty</span>
            ${kit.hasBattery ? `<span class="kit-spec-tag highlight">${(kit.batteryCapacityWh / 1000).toFixed(1)}kWh battery</span>` : ''}
            ${isCompatible ? '<span class="kit-spec-tag" style="background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.2); color: #10B981;">✓ Compatible</span>' : ''}
          </div>

          <div style="margin-bottom: 12px;">
            ${kit.features.map(f => `
              <span style="font-size: 0.75rem; color: var(--text-muted); display: inline-block; margin-right: 10px;">• ${f}</span>
            `).join('')}
          </div>

          <div class="kit-footer">
            <div class="kit-price">£${kit.price}</div>
            <a href="${kit.storeUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-outline" 
               onclick="event.stopPropagation();">
              View Store →
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export function init() {
  initFilters();
  initKitSelection();

  document.getElementById('btn-back-kits')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-kits')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });
}

function initFilters() {
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const filterType = chip.dataset.filter;
      const value = chip.dataset.value;
      
      // Update active state for this filter group
      document.querySelectorAll(`.filter-chip[data-filter="${filterType}"]`).forEach(c => {
        c.classList.remove('active');
      });
      chip.classList.add('active');
      
      activeFilters[filterType] = value;
      applyFilters();
    });
  });
}

function applyFilters() {
  let filtered = [...kitsData];

  if (activeFilters.wattage === 'small') {
    filtered = filtered.filter(k => k.wattage <= 400);
  } else if (activeFilters.wattage === 'large') {
    filtered = filtered.filter(k => k.wattage >= 700);
  }

  if (activeFilters.battery === 'yes') {
    filtered = filtered.filter(k => k.hasBattery);
  } else if (activeFilters.battery === 'no') {
    filtered = filtered.filter(k => !k.hasBattery);
  }

  if (activeFilters.brand !== 'all') {
    filtered = filtered.filter(k => k.brand === activeFilters.brand);
  }

  const selectedKit = getState('selectedKit');
  document.getElementById('kits-grid').innerHTML = renderKits(filtered, selectedKit?.id);
  initKitSelection();
}

function initKitSelection() {
  document.querySelectorAll('.kit-card').forEach(card => {
    card.addEventListener('click', () => {
      const kitId = card.dataset.kitId;
      const kit = kitsData.find(k => k.id === kitId);
      
      if (!kit) return;

      // Toggle selection
      const currentKit = getState('selectedKit');
      if (currentKit?.id === kitId) {
        setState({ selectedKit: null });
        card.classList.remove('selected');
        document.getElementById('btn-next-kits').disabled = true;
      } else {
        setState({ selectedKit: kit });
        document.querySelectorAll('.kit-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        document.getElementById('btn-next-kits').disabled = false;
      }
    });
  });
}
