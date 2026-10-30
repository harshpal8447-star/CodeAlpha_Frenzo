/**
 * Frenzo Frontend Application Entry Point
 * Initializes responsive layout handlers, SPA shell events, and health diagnostics.
 */
import { DiagnosticsComponent } from './components/Diagnostics.js';
import { API_CONFIG } from './api/config.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Frenzo Client Initialized — Phase 1 Foundation Shell');
    console.log(`📡 Connecting to API Gateway: ${API_CONFIG.BASE_URL}`);

    // Initialize System Diagnostic Component
    const diagnosticMount = document.getElementById('diagnostic-widget-mount');
    if (diagnosticMount) {
        const diagnostics = new DiagnosticsComponent(diagnosticMount);
        diagnostics.init();
    }

    // Set up interactive navigation tab states (Foundation demonstration)
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            const target = item.getAttribute('data-nav') || 'home';
            console.log(`Navigation triggered: ${target} (Routing will be active in Phase 2+)`);
        });
    });

    // Mobile navigation active indicator
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
    mobileNavItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            mobileNavItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });
});
