import config from '../data/config.json';

const HERO_IMAGE = 'https://lh3.googleusercontent.com/aida-public/AB6AXuCFU8LeqFOYBLsc_ES6Qn_ovY035RyeYpBruSpw3B-T0KEuUdxtepVX3LlnpCgl00uAuXNn-nU5-DBvQOmUQiYDDmpi0q8I-XeFmwTPBJEQLqTiXFxIukuUprN30GpIAtV6O1QLXYthLpa3_936avNwLsWivKJD2jEKzBuh6rGru1MfSevXhcFAC2wT83euuIWZUdkak1EZP7RSNq-lh0sJLo_7iwPQCbeTvPtIgxNIiNQ3ekil8p4rXh2d_lOaJ8UUtRJ-VRqnf4M';
const MAP_IMAGE = 'https://lh3.googleusercontent.com/aida-public/AB6AXuB5L9H4eWo6rGxYAtGSp64_Mj4BagvdtOP4HElOqf4AW51GHOP-bI7dzXg6ZgeEUfHwNX97KFB6z3BDsAWccgkWAhMY6_JGKCXIYTSvtkome_-c0vDPrWxG-8h5lKFfHR5fiBZtvVkHfZ0GdWSn09qttdji3QhiwpWb50m83XYHMLNpWuEVFzPNVp3-HkEAMtecc4bRR3uzr_TzpWAITBImHVbKNhcM_dHVx3iDVwJDxu7cz4r0t-VrkbSTbCVNbsCafJoF6Bf_6mc';

export function render() {
  return `
    <div class="landing-reference" id="landing-section">
      <section class="landing-hero-section">
        <div class="landing-hero-background">
          <img class="landing-hero-image" src="${HERO_IMAGE}" alt="Contemporary UK home with discreet plug-in solar panels" />
          <div class="landing-hero-overlay"></div>
        </div>

        <div class="landing-shell-ref">
          <div class="landing-hero-grid-ref">
            <div class="landing-hero-copy">
              <div class="landing-ref-badge">
                <span class="material-symbols-outlined">bolt</span>
                <span>WattPatch Solar Planner</span>
              </div>

              <h1 class="landing-ref-title">
                The smartest way to find your best
                <span class="text-gradient">WattPatch.</span>
              </h1>

              <p class="landing-ref-description">
                Analyse shadows, compare kits, and estimate your UK energy value in under 5 minutes.
              </p>

              <div class="landing-ref-actions">
                <button class="btn btn-primary btn-lg" id="btn-get-started">
                  Start Free Assessment
                  <span class="material-symbols-outlined">arrow_forward</span>
                </button>
                <a href="#how-it-works" class="btn btn-secondary btn-lg">
                  How it works
                </a>
              </div>
            </div>

            <div class="landing-circle-panel">
              <div class="landing-circle-glow"></div>
              <div class="landing-circle-value">${config.maxWattage}W</div>
              <div class="landing-circle-label">Plug-in Power Limit</div>
              <div class="landing-circle-pill-row">
                <div class="landing-circle-pill success">
                  <span class="material-symbols-outlined">bolt</span>
                  <span>${config.electricityPrice}p/kWh grid price</span>
                </div>
                <div class="landing-circle-pill">
                  <span class="material-symbols-outlined">outbound</span>
                  <span>£0 export payment assumed</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="landing-trust-strip">
        <div class="landing-shell-ref">
          <div class="landing-trust-grid">
            <div class="landing-trust-item">
              <span class="landing-trust-value">${config.maxWattage}W Max</span>
              <span class="landing-trust-label">Plug-in Power</span>
            </div>
            <div class="landing-trust-item">
              <span class="landing-trust-value">DIY Fit</span>
              <span class="landing-trust-label">No Electrician Needed</span>
            </div>
            <div class="landing-trust-item">
              <span class="landing-trust-value">Fully Legal</span>
              <span class="landing-trust-label">Now Legal in the UK</span>
            </div>
            <div class="landing-trust-item">
              <span class="landing-trust-value">4-6 Year</span>
              <span class="landing-trust-label">Typical Payback</span>
            </div>
          </div>
        </div>
      </section>

      <section class="landing-features-section" id="how-it-works">
        <div class="landing-shell-ref">
          <div class="landing-features-head">
            <div class="landing-features-copy">
              <h2 class="landing-features-title">Precision Solar Planning</h2>
              <p class="landing-features-subtitle">
                A premium WattPatch planning flow for UK plug-in solar, built around real placement, shadowing, kit choice, and battery recovery.
              </p>
            </div>
            <div class="landing-features-accent">Expert Analysis</div>
          </div>

          <div class="landing-bento-grid">
            <article class="landing-bento-card landing-bento-card-large">
              <div class="landing-bento-image-wrap">
                <img class="landing-bento-image" src="${MAP_IMAGE}" alt="Architectural map and solar planning view" />
              </div>
              <div class="landing-bento-content">
                <div class="landing-bento-icon landing-bento-icon-solid">
                  <span class="material-symbols-outlined">location_on</span>
                </div>
                <div>
                  <h3 class="landing-bento-title">Location Search</h3>
                  <p class="landing-bento-text">Pinpoint your balcony, wall, fence, shed, or garden spot with high-resolution UK mapping data.</p>
                </div>
              </div>
            </article>

            <article class="landing-bento-card">
              <div class="landing-bento-topline">
                <div class="landing-bento-icon">
                  <span class="material-symbols-outlined">brightness_low</span>
                </div>
                <span class="landing-bento-pill">Sun Path Model</span>
              </div>
              <div>
                <h3 class="landing-bento-title">Shadow Analysis</h3>
                <p class="landing-bento-text">Simulate seasonal shade from nearby buildings, fences, sheds, and trees before you pick a kit.</p>
              </div>
            </article>

            <article class="landing-bento-card">
              <div class="landing-bento-icon">
                <span class="material-symbols-outlined">recommend</span>
              </div>
              <div>
                <h3 class="landing-bento-title">Best Spot Recommendation</h3>
                <p class="landing-bento-text">Rank candidate positions by likely sun access, confidence, and year-round energy performance.</p>
              </div>
            </article>

            <article class="landing-bento-card" id="landing-kits">
              <div class="landing-bento-icon">
                <span class="material-symbols-outlined">compare_arrows</span>
              </div>
              <div>
                <h3 class="landing-bento-title">Kit Comparison</h3>
                <p class="landing-bento-text">Compare real 400W and 800W plug-in kits from EcoFlow, Thunder Energy, Zendure, and Anker SOLIX.</p>
              </div>
            </article>

            <article class="landing-bento-card">
              <div class="landing-bento-icon">
                <span class="material-symbols-outlined">query_stats</span>
              </div>
              <div>
                <h3 class="landing-bento-title">Value Summary</h3>
                <p class="landing-bento-text">See likely annual generation, payback, and how much on-site value your selected location can unlock.</p>
              </div>
            </article>

            <article class="landing-bento-card">
              <div class="landing-bento-icon landing-bento-icon-success">
                <span class="material-symbols-outlined">battery_charging_full</span>
              </div>
              <div>
                <h3 class="landing-bento-title">Battery Recovery</h3>
                <p class="landing-bento-text">Understand how storage can reduce unpaid spill and keep more midday solar for later home use.</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section class="landing-cta-section">
        <div class="landing-shell-ref">
          <div class="landing-cta-card" id="landing-cta">
            <div class="landing-cta-glow"></div>
            <div class="landing-cta-body">
              <h2 class="landing-cta-title">Ready to build your plug-in solar quote?</h2>
              <p class="landing-cta-text">
                Start with the map, mark your likely mounting spaces, and let the app rank the strongest option before you choose hardware.
              </p>
              <div class="landing-cta-actions">
                <button class="btn btn-primary btn-lg" id="btn-get-started-secondary">Get Your Free Report</button>
                <span class="landing-cta-caption">No credit card required.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer class="landing-footer" id="landing-footer">
        <div class="landing-shell-ref landing-footer-inner">
          <div class="landing-footer-brand">WattPatch</div>
          <div class="landing-footer-links">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Methodology</a>
          </div>
          <div class="landing-footer-copy">Find the best patch for UK plug-in solar</div>
        </div>
      </footer>
    </div>
  `;
}

export function init() {
  const startButtons = [
    document.getElementById('btn-get-started'),
    document.getElementById('btn-get-started-secondary'),
  ].filter(Boolean);

  startButtons.forEach((button) => {
    button.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('wizard:next'));
    });
  });

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.landing-bento-card, .landing-trust-item, .landing-cta-card').forEach((element) => {
    observer.observe(element);
  });
}
