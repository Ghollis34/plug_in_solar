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
  { id: 'buildings', label: 'Heights', module: buildingHeights, showProgress: true },
  { id: 'spaces', label: 'Spaces', module: markSpace, showProgress: true },
  { id: 'shadows', label: 'Shadows', module: shadowAnalysis, showProgress: true },
  { id: 'kits', label: 'Kits', module: kitSelection, showProgress: true },
  { id: 'results', label: 'Results', module: results, showProgress: true },
];

let currentStep = 0;
let currentModule = null;

function init() {
  // Restore step from state (but always start from landing)
  currentStep = 0;
  renderStep(currentStep);

  // Listen for wizard navigation events
  window.addEventListener('wizard:next', () => navigateNext());
  window.addEventListener('wizard:back', () => navigateBack());
  window.addEventListener('wizard:reset', () => resetWizard());
  window.addEventListener('wizard:goto', (e) => goToStep(e.detail.step));

  // Start over button
  document.getElementById('btn-start-over')?.addEventListener('click', () => {
    if (confirm('Start over? Your current progress will be reset.')) {
      resetWizard();
    }
  });
}

function navigateNext() {
  if (currentStep < steps.length - 1) {
    cleanupCurrentStep();
    currentStep++;
    setState({ currentStep });
    renderStep(currentStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function navigateBack() {
  if (currentStep > 0) {
    cleanupCurrentStep();
    currentStep--;
    setState({ currentStep });
    renderStep(currentStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function goToStep(stepIndex) {
  if (stepIndex >= 0 && stepIndex < steps.length) {
    cleanupCurrentStep();
    currentStep = stepIndex;
    setState({ currentStep });
    renderStep(currentStep);
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

  // Animate transition
  contentEl.style.animation = 'none';
  contentEl.offsetHeight; // trigger reflow
  contentEl.style.animation = 'fadeSlideIn 0.5s ease forwards';

  // Render step content
  contentEl.innerHTML = step.module.render();

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
    step.module.init();
  });
}

function updateProgressBar(stepIndex) {
  const progressSteps = steps.filter(s => s.showProgress);
  const currentProgressIndex = progressSteps.findIndex(s => s.id === steps[stepIndex].id);
  const totalProgressSteps = progressSteps.length;
  
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
      if (i === currentProgressIndex) cls += ' active';
      else if (i < currentProgressIndex) cls += ' completed';
      return `<span class="${cls}">${step.label}</span>`;
    }).join('');
  }
}

// Boot the app
document.addEventListener('DOMContentLoaded', init);
