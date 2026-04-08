import './style.css';
import { getState, setState, resetState, subscribe } from './utils/state.js';

// Step modules
import * as landing from './steps/landing.js';
import * as location from './steps/location.js';
import * as buildingHeights from './steps/building-heights.js';
import * as markSpace from './steps/mark-space.js';
import * as shadowAnalysis from './steps/shadow-analysis.js';
import * as kitSelection from './steps/kit-selection.js';
import * as results from './steps/results.js';

const steps = [
  { id: 'landing', label: 'Welcome', module: landing, showProgress: false },
  { id: 'location', label: 'Location', module: location, showProgress: true },
  { id: 'buildings', label: 'Site Setup', module: buildingHeights, showProgress: true },
  { id: 'spaces', label: 'Placement', module: markSpace, showProgress: true },
  { id: 'shadows', label: 'Shadows', module: shadowAnalysis, showProgress: true },
  { id: 'kits', label: 'Kits', module: kitSelection, showProgress: true },
  { id: 'results', label: 'Results', module: results, showProgress: true },
];

let currentStep = 0;
let currentModule = null;

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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function navigateBack() {
  if (currentStep > 0) {
    cleanupCurrentStep();
    currentStep--;
    renderStep(currentStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function goToStep(stepIndex) {
  if (stepIndex >= 0 && stepIndex < steps.length && canNavigateToStep(stepIndex)) {
    cleanupCurrentStep();
    currentStep = stepIndex;
    renderStep(currentStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function resetWizard() {
  cleanupCurrentStep();
  resetState();
  currentStep = 0;
  renderStep(currentStep);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cleanupCurrentStep() {
  if (currentModule?.cleanup) {
    currentModule.cleanup();
  }
}

function renderStep(stepIndex) {
  const step = steps[stepIndex];
  const contentEl = document.getElementById('step-content');
  const progressEl = document.getElementById('progress-bar');
  const startOverBtn = document.getElementById('btn-start-over');

  if (!contentEl) return;

  document.documentElement.style.setProperty('--header-height', step.showProgress ? '112px' : '72px');
  syncStepProgress(stepIndex);

  // Animate transition
  contentEl.style.animation = 'none';
  contentEl.offsetHeight; // trigger reflow
  contentEl.style.animation = 'fadeSlideIn 0.5s ease forwards';

  // Render step content
  contentEl.innerHTML = step.module.render();
  updateHeader(step);

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

  // Initialize step
  currentModule = step.module;
  
  // Use requestAnimationFrame to ensure DOM is ready
  requestAnimationFrame(() => {
    bindHeaderLinks();
    step.module.init();
  });
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
