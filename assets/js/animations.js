/**
 * TNT Diwali Order Management System
 * Global Animations & Interactive Micro-Interactions Controller
 * 
 * Features:
 * 1. IntersectionObserver scroll-reveal for cards, sections, and footer items
 * 2. Sticky header elevation & glassmorphism on scroll
 * 3. Smooth back-to-top scrolling button
 * 4. Micro-interactions for buttons, cards, and cart badge pulses
 */

export function initGlobalAnimations() {
  if (typeof window === 'undefined') return;

  // 1. Sticky Header Glassmorphic Transition on Scroll
  const header = document.querySelector('.site-header');
  if (header) {
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (window.scrollY > 20) {
            header.classList.add('scrolled');
          } else {
            header.classList.remove('scrolled');
          }
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
    // Run once on load
    if (window.scrollY > 20) header.classList.add('scrolled');
  }

  // 2. Scroll Reveal Animations with IntersectionObserver
  const revealElements = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealElements.length > 0) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          obs.unobserve(entry.target);
        }
      });
    }, {
      root: null,
      threshold: 0.12,
      rootMargin: '0px 0px -40px 0px'
    });

    revealElements.forEach(el => observer.observe(el));
  } else {
    // Fallback if IntersectionObserver is not supported
    revealElements.forEach(el => el.classList.add('revealed'));
  }

  // 3. Back to Top Smooth Scroll Button
  const backToTopBtn = document.getElementById('footer-back-to-top-btn');
  if (backToTopBtn) {
    backToTopBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
  }

  // 4. Cart Badge Pulse Animation on Update
  window.addEventListener('tnt:cart-updated', () => {
    const badges = document.querySelectorAll('.tnt-cart-badge');
    badges.forEach(b => {
      b.classList.remove('badge-pulse');
      // Trigger DOM reflow to re-trigger CSS keyframe
      void b.offsetWidth;
      b.classList.add('badge-pulse');
    });
  });

  // 5. Enhance Mobile Nav Toggle
  const mobileBtn = document.getElementById('mobile-menu-btn');
  const navMenu = document.getElementById('nav-menu');
  if (mobileBtn && navMenu) {
    if (!mobileBtn.dataset.animAttached) {
      mobileBtn.dataset.animAttached = 'true';

      mobileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = navMenu.classList.toggle('open');
        mobileBtn.setAttribute('aria-expanded', String(isOpen));
        mobileBtn.classList.toggle('is-active', isOpen);
      });

      // Close mobile menu when clicking any nav link
      navMenu.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
          navMenu.classList.remove('open');
          mobileBtn.setAttribute('aria-expanded', 'false');
          mobileBtn.classList.remove('is-active');
        });
      });

      // Close mobile menu when clicking outside
      document.addEventListener('click', (e) => {
        if (!navMenu.contains(e.target) && !mobileBtn.contains(e.target)) {
          if (navMenu.classList.contains('open')) {
            navMenu.classList.remove('open');
            mobileBtn.setAttribute('aria-expanded', 'false');
            mobileBtn.classList.remove('is-active');
          }
        }
      });
    }
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGlobalAnimations);
} else {
  initGlobalAnimations();
}
