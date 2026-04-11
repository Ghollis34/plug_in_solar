import kitsData from '../data/kits.json';
import { getState, setState } from '../utils/state.js';
import { escapeHtml, safeDataId } from '../utils/security.js';
import { getSpacesState } from '../utils/site-state.js';

let activeFilters = { wattage: 'all', brand: 'all' };

export function render() {
  const selectedKit = getState('selectedKit');

  return `
    <div class="step-page scrollable">
      <div class="step-header">
        <div class="section-kicker">Step 5 · Kits</div>
        <h2 class="step-title">Choose Your Kit</h2>
        <p class="step-subtitle">Pick the package you want to price first, then compare the brands that fit your chosen mounting space.</p>
      </div>

      <div class="step-body">
        <div class="kit-page-lead">
          <div>
            <div class="map-panel-kicker">Package choice first</div>
            <h3 class="map-panel-title">Compare plug-in solar bundles before you jump to a retailer.</h3>
          </div>
          <div class="map-panel-pill">Results page handles retailer handoff</div>
        </div>

        <div class="kit-package-summary">
          <div class="kit-package-card">
            <div class="kit-package-eyebrow">Solar Only</div>
            <div class="kit-package-title">Lower upfront cost</div>
            <div class="kit-package-copy">Use what you can live, with any spare daytime generation treated as unpaid spill in this quote model.</div>
          </div>
          <div class="kit-package-card battery">
            <div class="kit-package-eyebrow">Battery Combo</div>
            <div class="kit-package-title">More evening self-use</div>
            <div class="kit-package-copy">Add storage to keep more midday solar for later instead of losing that value when it spills away unused.</div>
          </div>
        </div>

        <div class="kit-filters" id="kit-filters">
          <button class="filter-chip active" data-filter="wattage" data-value="all">All Sizes</button>
          <button class="filter-chip" data-filter="wattage" data-value="small">≤400W</button>
          <button class="filter-chip" data-filter="wattage" data-value="large">700W+</button>
          <span style="color: var(--border); padding: 0 4px;">|</span>
          <button class="filter-chip active" data-filter="brand" data-value="all">All Brands</button>
          ${[...new Set(kitsData.map((kit) => kit.brand))].map((brand) => `
            <button class="filter-chip" data-filter="brand" data-value="${safeDataId(brand)}">${escapeHtml(brand)}</button>
          `).join('')}
        </div>

        <div class="analysis-note mb-md">
          Retailer links move to the results page after you choose a setup, so you can compare the value case and battery recovery case first.
        </div>

        <div id="kits-grid">
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

  const solarOnly = kits.filter((kit) => !kit.hasBattery);
  const batteryCombos = kits.filter((kit) => kit.hasBattery);

  return `
    ${renderKitSection(
      'Solar Only',
      'Lower upfront spend. Best if you want the cheapest route into plug-in solar first.',
      solarOnly,
      selectedId
    )}
    ${renderKitSection(
      'Solar + Battery Combo',
      'Higher upfront spend, but better at shifting midday generation into evening usage.',
      batteryCombos,
      selectedId
    )}
  `;
}

function renderKitSection(title, subtitle, kits, selectedId) {
  if (!kits.length) {
    return '';
  }

  return `
    <section class="kit-section">
      <div class="kit-section-header">
        <div>
          <h3 class="kit-section-title">${title}</h3>
          <p class="kit-section-copy">${subtitle}</p>
        </div>
        <span class="kit-section-count">${kits.length} option${kits.length > 1 ? 's' : ''}</span>
      </div>
      <div class="kits-grid">
        ${kits.map((kit) => renderKitCard(kit, selectedId)).join('')}
      </div>
    </section>
  `;
}

function renderKitCard(kit, selectedId) {
  const isSelected = kit.id === selectedId;
  const spaces = getSpacesState();
  const spaceTypes = spaces.map((space) => space.type);
  const isCompatible = kit.mountingTypes.some((mountType) => spaceTypes.includes(mountType)) || spaceTypes.length === 0;

  return `
    <div class="card kit-card ${isSelected ? 'selected' : ''}" data-kit-id="${safeDataId(kit.id)}" id="kit-${safeDataId(kit.id)}">
      <div class="kit-select-badge">✓ Selected</div>
      <div class="kit-card-image">
        <span style="font-size: 3rem;">${kit.hasBattery ? '🔋' : '☀️'}</span>
      </div>
      <div class="kit-card-body">
        <div class="kit-card-topline">
          <div class="kit-brand">${escapeHtml(kit.brand)}</div>
          <span class="kit-package-pill ${kit.hasBattery ? 'battery' : 'solar'}">${kit.hasBattery ? 'Battery combo' : 'Solar only'}</span>
        </div>
        <h3 class="kit-name">${escapeHtml(kit.name)}</h3>
        <p class="kit-desc">${escapeHtml(kit.description)}</p>

        <div class="kit-specs">
          <span class="kit-spec-tag highlight">${kit.wattage}W</span>
          <span class="kit-spec-tag">${kit.panelCount} panel${kit.panelCount > 1 ? 's' : ''}</span>
          <span class="kit-spec-tag">${kit.weightKg}kg</span>
          <span class="kit-spec-tag">${kit.warrantyYears}yr warranty</span>
          ${kit.hasBattery ? `<span class="kit-spec-tag highlight">${(kit.batteryCapacityWh / 1000).toFixed(1)}kWh battery</span>` : ''}
          ${isCompatible ? '<span class="kit-spec-tag" style="background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.2); color: #10B981;">✓ Compatible</span>' : ''}
        </div>

        <div style="margin-bottom: 12px;">
          ${kit.features.map((feature) => `
            <span style="font-size: 0.75rem; color: var(--text-muted); display: inline-block; margin-right: 10px;">• ${escapeHtml(feature)}</span>
          `).join('')}
        </div>

        <div class="kit-footer">
          <div>
            <div class="kit-price">£${kit.price}</div>
            <div class="kit-price-note">${kit.hasBattery ? 'Solar + storage package' : 'Solar generation only'}</div>
          </div>
          <div class="kit-select-hint">${isSelected ? 'Selected for quote' : 'Click to select'}</div>
        </div>
      </div>
    </div>
  `;
}

export function init() {
  initFilters();
  initKitSelection();
  updateNextButton();

  document.getElementById('btn-back-kits')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:back'));
  });

  document.getElementById('btn-next-kits')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('wizard:next'));
  });
}

function initFilters() {
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const filterType = chip.dataset.filter;
      const value = chip.dataset.value;

      document.querySelectorAll(`.filter-chip[data-filter="${filterType}"]`).forEach((entry) => {
        entry.classList.remove('active');
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
    filtered = filtered.filter((kit) => kit.wattage <= 400);
  } else if (activeFilters.wattage === 'large') {
    filtered = filtered.filter((kit) => kit.wattage >= 700);
  }

  if (activeFilters.brand !== 'all') {
    filtered = filtered.filter((kit) => kit.brand === activeFilters.brand);
  }

  const selectedKit = getState('selectedKit');
  document.getElementById('kits-grid').innerHTML = renderKits(filtered, selectedKit?.id);
  initKitSelection();
  updateNextButton();
}

function initKitSelection() {
  document.querySelectorAll('.kit-card').forEach((card) => {
    card.addEventListener('click', () => {
      const kitId = card.dataset.kitId;
      const kit = kitsData.find((entry) => entry.id === kitId);
      if (!kit) return;

      const currentKit = getState('selectedKit');
      if (currentKit?.id === kitId) {
        setState({ selectedKit: null });
        card.classList.remove('selected');
      } else {
        setState({ selectedKit: kit });
        document.querySelectorAll('.kit-card').forEach((entry) => entry.classList.remove('selected'));
        card.classList.add('selected');
      }

      updateNextButton();
    });
  });
}

function updateNextButton() {
  const nextButton = document.getElementById('btn-next-kits');
  if (nextButton) {
    nextButton.disabled = !getState('selectedKit');
  }
}
