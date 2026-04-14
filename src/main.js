import './style.css';
import { getState, setState, resetState } from './utils/state.js';

const steps = [
  { id: 'landing', label: 'Welcome', showProgress: false, load: () => import('./steps/landing.js'), module: null },
  { id: 'location', label: 'Location', showProgress: true, load: () => import('./steps/location.js'), module: null },
  { id: 'buildings', label: 'Site Setup', showProgress: true, load: () => import('./steps/building-heights.js'), module: null },
  { id: 'spaces', label: 'Placement', showProgress: true, load: () => import('./steps/mark-space.js'), module: null },
  { id: 'shadows', label: 'Shadows', showProgress: true, load: () => import('./steps/shadow-analysis.js'), module: null },
  { id: 'kits', label: 'Kits', showProgress: true, load: () => import('./steps/kit-selection.js'), module: null },
  { id: 'results', label: 'Results', showProgress: true, load: () => import('./steps/results.js'), module: null },
];

let currentStep = 0;
let currentModule = null;
let renderRequestId = 0;

function init() {
  const savedCurrentStep = Number.isFinite(getState('currentStep')) ? getState('currentStep') : 0;
  const savedMaxVisitedStep = Number.isFinite(getState('maxVisitedStep')) ? getState('maxVisitedStep') : 0;
  const derivedMaxVisitedStep = Math.max(0, savedCurrentStep, savedMaxVisitedStep);

  if (derivedMaxVisitedStep !== savedMaxVisitedStep) {
    setState({ maxVisitedStep: derivedMaxVisitedStep });
  }

  // Restore step from state (but always start from landing)
  currentStep = 0;
  renderStep(currentStep);

  // Listen for wizard navigation events
  window.addEventListener('wizard:next', () => navigateNext());
  window.addEventListener('wizard:back', () => navigateBack());
  window.addEventListener('wizard:reset', () => resetWizard());
  window.addEventListener('wizard:goto', (e) => goToStep(e.detail.step));

  document.getElementById('progress-steps')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-step-index]');
    if (!button || button.disabled) return;

    const stepIndex = parseInt(button.dataset.stepIndex || '', 10);
    if (!Number.isFinite(stepIndex)) return;
    goToStep(stepIndex);
  });

  // Start over button
  document.getElementById('btn-start-over')?.addEventListener('click', () => {
    if (confirm('Start again? Your current progress will be reset.')) {
      resetWizard();
    }
  });
}

function navigateNext() {
  if (currentStep < steps.length - 1) {
    cleanupCurrentStep();
    currentStep++;
    renderStep(currentStep);
  }
}

function navigateBack() {
  if (currentStep > 0) {
    cleanupCurrentStep();
    currentStep--;
    renderStep(currentStep);
  }
}

function goToStep(stepIndex) {
  if (stepIndex >= 0 && stepIndex < steps.length && canNavigateToStep(stepIndex)) {
    cleanupCurrentStep();
    currentStep = stepIndex;
    renderStep(currentStep);
  }
}

function resetWizard() {
  cleanupCurrentStep();
  resetState();
  currentStep = 0;
  renderStep(currentStep);
}

function cleanupCurrentStep() {
  if (currentModule?.cleanup) {
    currentModule.cleanup();
  }
}

async function renderStep(stepIndex) {
  const step = steps[stepIndex];
  const contentEl = document.getElementById('step-content');
  const progressEl = document.getElementById('progress-bar');
  const startOverBtn = document.getElementById('btn-start-over');
  const requestId = ++renderRequestId;

  if (!contentEl) return;

  document.documentElement.style.setProperty('--header-height', step.showProgress ? '112px' : '72px');
  syncStepProgress(stepIndex);

  // Animate transition
  contentEl.style.animation = 'none';
  contentEl.offsetHeight; // trigger reflow
  contentEl.style.animation = 'fadeSlideIn 0.5s ease forwards';

  updateHeader(step);
  currentModule = null;
  contentEl.innerHTML = renderStepLoading(step.label);

  // Show/hide progress bar
  if (step.showProgress && progressEl) {
    progressEl.style.display = 'block';
    updateProgressBar(stepIndex);
  } else if (progressEl) {
    progressEl.style.display = 'none';
  }

  // Show/hide start over button
  if (startOverBtn) {
    startOverBtn.style.display = stepIndex > 0 ? 'block' : 'none';
  }

  let stepModule;
  try {
    stepModule = await loadStepModule(step);
  } catch (error) {
    if (requestId !== renderRequestId) return;
    console.error(`Failed to load step "${step.id}":`, error);
    contentEl.innerHTML = `
      <div class="loading-overlay" style="min-height: 40vh;">
        <div style="font-size: 1.5rem; color: var(--danger);">⚠️</div>
        <p>Failed to load this step.</p>
        <button class="btn btn-secondary" id="btn-retry-step">Retry</button>
      </div>
    `;
    document.getElementById('btn-retry-step')?.addEventListener('click', () => {
      renderStep(stepIndex);
    });
    return;
  }
  if (requestId !== renderRequestId) return;

  contentEl.innerHTML = stepModule.render();
  currentModule = stepModule;
  resetRenderedStepScroll(contentEl);

  requestAnimationFrame(() => {
    if (requestId !== renderRequestId) return;
    bindHeaderLinks();
    stepModule.init?.();
    preloadLikelyNextStep(stepIndex);
  });
}

function renderStepLoading(stepLabel) {
  return `
    <div class="loading-overlay" style="min-height: 40vh;">
      <div class="loading-spinner"></div>
      <p>Loading ${stepLabel.toLowerCase()}…</p>
    </div>
  `;
}

async function loadStepModule(step) {
  if (step.module) {
    return step.module;
  }

  const module = await step.load();
  step.module = module;
  return module;
}

function preloadLikelyNextStep(stepIndex) {
  const nextStep = steps[stepIndex + 1];
  if (!nextStep || nextStep.module) return;
  void loadStepModule(nextStep);
}

function resetRenderedStepScroll(contentEl) {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  if (!contentEl) return;

  contentEl.scrollTop = 0;
  contentEl.querySelector('.step-page')?.scrollTo(0, 0);
  contentEl.querySelector('.step-body')?.scrollTo(0, 0);
}

function updateHeader(step) {
  const headerEl = document.getElementById('app-header');
  const headerLinksEl = document.getElementById('header-links');
  const isLanding = step.id === 'landing';

  document.body.classList.toggle('landing-step-active', isLanding);
  headerEl?.classList.toggle('landing-mode', isLanding);
  headerEl?.classList.toggle('has-progress', step.showProgress);

  if (!headerLinksEl) return;

  if (!isLanding) {
    headerLinksEl.innerHTML = '';
    headerLinksEl.style.display = 'none';
    return;
  }

  headerLinksEl.innerHTML = `
    <a class="header-link active" href="#landing-section">Home</a>
    <a class="header-link" href="#how-it-works">How it works</a>
    <a class="header-link" href="#landing-kits">Solar Kits</a>
    <a class="header-link" href="#landing-footer">Contact</a>
  `;
  headerLinksEl.style.display = 'flex';
}

function bindHeaderLinks() {
  document.querySelectorAll('#header-links a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const targetId = link.getAttribute('href');
      if (!targetId) return;
      const targetEl = document.querySelector(targetId);
      if (!targetEl) return;
      event.preventDefault();
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function updateProgressBar(stepIndex) {
  const progressSteps = steps
    .map((step, index) => ({ ...step, index }))
    .filter((step) => step.showProgress);
  const currentProgressIndex = progressSteps.findIndex((step) => step.index === stepIndex);
  const totalProgressSteps = progressSteps.length;
  const maxVisitedStep = getMaxVisitedStep();
  const highestNavigableStep = getHighestNavigableStep();
  
  // Update fill
  const fillPercent = ((currentProgressIndex + 1) / totalProgressSteps) * 100;
  const fillEl = document.getElementById('progress-fill');
  if (fillEl) {
    fillEl.style.width = `${fillPercent}%`;
  }

  // Update step labels
  const stepsEl = document.getElementById('progress-steps');
  if (stepsEl) {
    stepsEl.innerHTML = progressSteps.map((step, i) => {
      let cls = 'progress-step';
      const isActive = i === currentProgressIndex;
      const isCompleted = i < currentProgressIndex;
      const isVisited = step.index <= maxVisitedStep && !isActive && !isCompleted;
      const isClickable = !isActive && step.index <= highestNavigableStep;

      if (isActive) cls += ' active';
      else if (isCompleted) cls += ' completed';
      else if (isVisited) cls += ' visited';

      if (isClickable) cls += ' clickable';
      else if (!isActive) cls += ' locked';

      return `
        <button
          type="button"
          class="${cls}"
          data-step-index="${step.index}"
          ${isActive || !isClickable ? 'disabled' : ''}
          ${isActive ? 'aria-current="step"' : ''}
        >
          ${step.label}
        </button>
      `;
    }).join('');
  }
}

function syncStepProgress(stepIndex) {
  const maxVisitedStep = Math.max(getMaxVisitedStep(), stepIndex);
  const updates = {};

  if (getState('currentStep') !== stepIndex) {
    updates.currentStep = stepIndex;
  }

  if (getState('maxVisitedStep') !== maxVisitedStep) {
    updates.maxVisitedStep = maxVisitedStep;
  }

  if (Object.keys(updates).length) {
    setState(updates);
  }
}

function getMaxVisitedStep() {
  const value = getState('maxVisitedStep');
  return Number.isFinite(value) ? value : 0;
}

function canNavigateToStep(stepIndex) {
  if (stepIndex === currentStep) return true;
  return stepIndex <= getHighestNavigableStep();
}

function getHighestNavigableStep() {
  return Math.min(getMaxVisitedStep(), getHighestReachableStepFromState());
}

function getHighestReachableStepFromState() {
  const state = getState();
  const hasLocation = Boolean(state.location);
  const hasUserBuilding = (state.buildings || []).some(
    (building) => building.kind === 'user' || building.id === 'user-building'
  );
  const hasSpaces = Array.isArray(state.spaces) && state.spaces.length > 0;
  const hasSelectedKit = Boolean(state.selectedKit);

  let highestStep = 1;

  if (!hasLocation) return highestStep;
  highestStep = 2;

  if (!hasUserBuilding) return highestStep;
  highestStep = 3;

  if (!hasSpaces) return highestStep;
  highestStep = 5;

  if (!hasSelectedKit) return highestStep;
  return 6;
}

// Boot the app
document.addEventListener('DOMContentLoaded', init);
