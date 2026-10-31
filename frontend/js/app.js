/**
 * Frenzo Frontend Application Entry Point
 * Initializes responsive layout, SPA view router, auth store, and UI state synchronization.
 */
import { DiagnosticsComponent } from './components/Diagnostics.js';
import { AuthView } from './components/AuthView.js';
import { authStore } from './state/authStore.js';
import { API_CONFIG } from './api/config.js';

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Frenzo Client Initialized — Phase 3.1 Authentication UI');
    console.log(`📡 Connecting to API Gateway: ${API_CONFIG.BASE_URL}`);

    // 1. Initialize System Diagnostic Component
    const diagnosticMount = document.getElementById('diagnostic-widget-mount');
    if (diagnosticMount) {
        const diagnostics = new DiagnosticsComponent(diagnosticMount);
        diagnostics.init();
    }

    // 2. DOM Elements
    const authViewMount = document.getElementById('auth-view-mount');
    const homeViewContent = document.getElementById('home-view-content');
    const mainViewTitle = document.getElementById('main-view-title');
    const headerAuthAction = document.getElementById('header-auth-action');
    const sidebarUserMount = document.getElementById('sidebar-user-mount');
    const navAuthItem = document.getElementById('nav-auth-item');
    const navAuthLabel = document.getElementById('nav-auth-label');

    // 3. Initialize AuthView Component
    let authView = null;
    if (authViewMount) {
        authView = new AuthView(authViewMount, {
            initialMode: window.location.hash === '#register' ? 'register' : 'login',
            onAuthSuccess: (user) => {
                console.log(`Auth success: Logged in as @${user.username}`);
                // Navigate back to home feed smoothly after brief success banner
                setTimeout(() => {
                    window.location.hash = '#feed';
                }, 750);
            }
        });
        authView.init();
    }

    // 4. View Routing Switchboard (Supports #feed, #login, #register, #auth)
    const handleRoute = () => {
        const hash = window.location.hash || '#feed';
        const isAuthRoute = hash === '#login' || hash === '#register' || hash === '#auth';

        // Update navigation active states
        const allNavItems = document.querySelectorAll('.nav-item');
        allNavItems.forEach(item => item.classList.remove('active'));

        if (isAuthRoute) {
            if (navAuthItem) navAuthItem.classList.add('active');

            if (authViewMount) authViewMount.style.display = 'block';
            if (homeViewContent) homeViewContent.style.display = 'none';

            const mode = hash === '#register' ? 'register' : 'login';
            if (authView) authView.setMode(mode);

            if (mainViewTitle) {
                mainViewTitle.textContent = mode === 'register' ? 'Create an Account' : 'Welcome Back';
            }
        } else {
            // Home / Feed Route
            const homeNavItem = document.querySelector('[data-nav="home"]');
            if (homeNavItem) homeNavItem.classList.add('active');

            if (authViewMount) authViewMount.style.display = 'none';
            if (homeViewContent) homeViewContent.style.display = 'flex';

            if (mainViewTitle) {
                mainViewTitle.textContent = 'Community Home';
            }
        }
    };

    window.addEventListener('hashchange', handleRoute);

    // 5. Update Header & Sidebar UI based on Auth State
    const updateAuthUI = (state) => {
        const { user, isAuthenticated, isLoading } = state;

        // 5.1 Sidebar User Widget
        if (sidebarUserMount) {
            if (isLoading) {
                sidebarUserMount.innerHTML = `
                    <div class="user-avatar-mini" style="background: #E2E8F0; color: #94A3B8;">...</div>
                    <div class="user-profile-meta">
                        <span class="user-display-name">Loading...</span>
                        <span class="user-username">Verifying session</span>
                    </div>
                `;
            } else if (isAuthenticated && user) {
                const initials = (user.display_name || user.username || 'F')
                    .split(' ')
                    .map(n => n[0])
                    .join('')
                    .toUpperCase()
                    .substring(0, 2);

                sidebarUserMount.innerHTML = `
                    <div class="sidebar-user-action">
                        <div style="display: flex; align-items: center; gap: var(--space-3); min-width: 0;">
                            <div class="user-avatar-mini" style="background: linear-gradient(135deg, var(--color-primary-violet) 0%, var(--color-midnight-navy) 100%); color: white;">
                                ${initials}
                            </div>
                            <div class="user-profile-meta" style="min-width: 0;">
                                <span class="user-display-name" title="${user.display_name || user.username}">${user.display_name || user.username}</span>
                                <span class="user-username">@${user.username}</span>
                            </div>
                        </div>
                        <button type="button" class="sidebar-logout-icon-btn" id="sidebar-logout-btn" title="Sign out" aria-label="Sign out">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                        </button>
                    </div>
                `;

                const logoutBtn = sidebarUserMount.querySelector('#sidebar-logout-btn');
                if (logoutBtn) {
                    logoutBtn.addEventListener('click', async () => {
                        logoutBtn.disabled = true;
                        logoutBtn.innerHTML = '<span class="btn-spinner" style="width: 14px; height: 14px; border-top-color: var(--color-danger); border-color: rgba(239,68,68,0.2);"></span>';
                        await authStore.logout();
                        window.location.hash = '#login';
                    });
                }
            } else {
                sidebarUserMount.innerHTML = `
                    <button type="button" class="sidebar-login-prompt-btn" id="sidebar-prompt-signin">
                        Sign In / Create Account
                    </button>
                `;
                const promptBtn = sidebarUserMount.querySelector('#sidebar-prompt-signin');
                if (promptBtn) {
                    promptBtn.addEventListener('click', () => {
                        window.location.hash = '#login';
                    });
                }
            }
        }

        // 5.2 Header Action Pills
        if (headerAuthAction) {
            if (isAuthenticated && user) {
                headerAuthAction.innerHTML = `
                    <span class="text-xs font-semibold" style="color: #065F46; background: var(--color-success-light); padding: 4px 10px; border-radius: var(--radius-full); display: inline-flex; align-items: center; gap: 4px;">
                        <span style="width: 6px; height: 6px; border-radius: 50%; background: #10B981;"></span>
                        @${user.username}
                    </span>
                    <button type="button" class="text-xs font-semibold" id="header-logout-btn" style="color: var(--color-text-muted); background: var(--color-porcelain); border: 1px solid var(--color-border-subtle); padding: 4px 12px; border-radius: var(--radius-full); cursor: pointer; transition: all 150ms;">
                        Sign Out
                    </button>
                `;
                const headerLogout = headerAuthAction.querySelector('#header-logout-btn');
                if (headerLogout) {
                    headerLogout.addEventListener('click', async () => {
                        headerLogout.disabled = true;
                        headerLogout.textContent = '...';
                        await authStore.logout();
                        window.location.hash = '#login';
                    });
                }
            } else {
                headerAuthAction.innerHTML = `
                    <a href="#login" class="text-xs font-semibold" style="color: var(--color-primary-violet); background: var(--color-primary-violet-light); padding: 5px 12px; border-radius: var(--radius-full); text-decoration: none; transition: all 150ms;">
                        Sign In
                    </a>
                    <a href="#register" class="text-xs font-semibold" style="color: white; background: var(--color-primary-violet); padding: 5px 12px; border-radius: var(--radius-full); text-decoration: none; transition: all 150ms;">
                        Join Frenzo
                    </a>
                `;
            }
        }

        // 5.3 Sidebar Nav Label
        if (navAuthLabel) {
            navAuthLabel.textContent = isAuthenticated ? 'Session' : 'Sign In / Join';
        }
    };

    authStore.subscribe(updateAuthUI);

    // 6. Navigation item click handling
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const target = item.getAttribute('data-nav') || 'home';
            if (target === 'auth') {
                e.preventDefault();
                window.location.hash = '#login';
            } else if (target === 'profile') {
                e.preventDefault();
                // If authenticated, show session card, else prompt login
                window.location.hash = '#auth';
            } else if (target === 'home') {
                e.preventDefault();
                window.location.hash = '#feed';
            }
        });
    });

    // Mobile navigation active indicator
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
    mobileNavItems.forEach(item => {
        item.addEventListener('click', () => {
            mobileNavItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // 7. Initial session detection and initial routing
    await authStore.init();
    handleRoute();
});
