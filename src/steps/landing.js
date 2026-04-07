import config from '../data/config.json';

export function render() {
  return `
    <section class="landing-hero" style="min-height: calc(100vh - var(--header-height)); height: auto; overflow: visible;"  id="landing-section">
      <div class="hero-content">
        <div class="hero-badge">
          <span>☀️</span>
          <span>Now legal in the UK — up to ${config.maxWattage}W plug-in solar</span>
        </div>

        <h1 class="hero-title">
          Find the <span class="text-gradient">Perfect Spot</span><br/>
          for Plug-In Solar
        </h1>

        <p class="hero-description">
          Analyse shadows from nearby buildings, compare the best plug-in solar kits, 
          and see exactly how much you'll save — all in under 5 minutes.
        </p>

        <div class="hero-cta-group">
          <button class="btn btn-primary btn-lg btn-pulse" id="btn-get-started">
            ☀️ Find Your Solar Sweet Spot
          </button>
          <a href="#how-it-works" class="btn btn-secondary btn-lg">
            How It Works ↓
          </a>
        </div>

        <div class="stats-banner">
          <div class="stat-item">
            <div class="stat-value">${config.electricityPrice}p</div>
            <div class="stat-label">per kWh electricity</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">4-5yr</div>
            <div class="stat-label">typical payback</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${config.maxWattage}W</div>
            <div class="stat-label">max plug-in power</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">£0</div>
            <div class="stat-label">electrician needed</div>
          </div>
        </div>
      </div>

      <div class="features-grid" id="how-it-works">
        <div class="card feature-card" style="animation-delay: 0.1s">
          <span class="feature-icon">📍</span>
          <h3 class="feature-title">Find Your Location</h3>
          <p class="feature-desc">Search your UK postcode and see your property in 3D with all surrounding buildings.</p>
        </div>
        <div class="card feature-card" style="animation-delay: 0.2s">
          <span class="feature-icon">🌤️</span>
          <h3 class="feature-title">Shadow Analysis</h3>
          <p class="feature-desc">Watch how shadows from nearby buildings move across your space throughout the day and year.</p>
        </div>
        <div class="card feature-card" style="animation-delay: 0.3s">
          <span class="feature-icon">⭐</span>
          <h3 class="feature-title">Best Spot Found</h3>
          <p class="feature-desc">We'll recommend the optimal position for your panels based on maximum sun exposure.</p>
        </div>
        <div class="card feature-card" style="animation-delay: 0.4s">
          <span class="feature-icon">🔋</span>
          <h3 class="feature-title">Compare Kits</h3>
          <p class="feature-desc">Browse real plug-in solar kits from top brands like EcoFlow, Zendure, and Thunder Energy.</p>
        </div>
        <div class="card feature-card" style="animation-delay: 0.5s">
          <span class="feature-icon">💰</span>
          <h3 class="feature-title">Calculate ROI</h3>
          <p class="feature-desc">See your estimated annual savings, payback period, and 25-year returns based on your actual location.</p>
        </div>
        <div class="card feature-card" style="animation-delay: 0.6s">
          <span class="feature-icon">🌍</span>
          <h3 class="feature-title">CO₂ Impact</h3>
          <p class="feature-desc">Find out how much carbon you'll offset — feel good about going green while saving money.</p>
        </div>
      </div>
    </section>
  `;
}

export function init() {
  const btn = document.getElementById('btn-get-started');
  if (btn) {
    btn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('wizard:next'));
    });
  }

  // Smooth scroll for "How It Works"
  const howLink = document.querySelector('a[href="#how-it-works"]');
  if (howLink) {
    howLink.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Animate feature cards on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animation = `fadeSlideIn 0.6s ease forwards ${entry.target.style.animationDelay || '0s'}`;
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.feature-card').forEach(card => {
    card.style.opacity = '0';
    observer.observe(card);
  });
}
