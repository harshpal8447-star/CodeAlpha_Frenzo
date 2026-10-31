/**
 * Frenzo Authentication View Component (Phase 3.1)
 * Provides responsive login and registration interfaces, client-side validation,
 * password visibility toggling, loading indicators, and error/success alerts.
 */
import { register as apiRegister, login as apiLogin } from '../api/authApi.js';
import { authStore } from '../state/authStore.js';
import { ApiError } from '../api/client.js';

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

export class AuthView {
    /**
     * @param {HTMLElement} container - DOM mount element
     * @param {object} options - { initialMode: 'login'|'register', onAuthSuccess: Function }
     */
    constructor(container, options = {}) {
        this.container = container;
        this.mode = options.initialMode || 'login'; // 'login' | 'register'
        this.onAuthSuccess = options.onAuthSuccess || (() => {});
        this.isSubmitting = false;
        this.isPasswordVisible = false;
        this.errors = {};
        this.serverAlert = null; // { type: 'danger'|'success', message: string }
        this.unsubscribe = null;
    }

    init() {
        this.unsubscribe = authStore.subscribe(() => {
            this.render();
        });
    }

    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }

    setMode(mode) {
        if (this.mode === mode) return;
        this.mode = mode;
        this.errors = {};
        this.serverAlert = null;
        this.isPasswordVisible = false;
        this.render();
    }

    togglePasswordVisibility() {
        this.isPasswordVisible = !this.isPasswordVisible;
        const passwordInput = this.container.querySelector('#auth-password');
        const toggleBtn = this.container.querySelector('.password-toggle-btn');
        if (passwordInput) {
            passwordInput.type = this.isPasswordVisible ? 'text' : 'password';
        }
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-label', this.isPasswordVisible ? 'Hide password' : 'Show password');
            toggleBtn.innerHTML = this.getPasswordIconSvg();
        }
    }

    getPasswordIconSvg() {
        if (this.isPasswordVisible) {
            // Eye-off icon
            return `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
            `;
        }
        // Eye icon
        return `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
        `;
    }

    validateLoginForm({ identifier, password }) {
        const errors = {};
        if (!identifier || !identifier.trim()) {
            errors.identifier = 'Please enter your username or email.';
        }
        if (!password) {
            errors.password = 'Please enter your password.';
        }
        return errors;
    }

    validateRegisterForm({ email, username, password, display_name }) {
        const errors = {};
        const trimmedEmail = email ? email.trim() : '';
        const trimmedUser = username ? username.trim() : '';

        if (!trimmedEmail) {
            errors.email = 'Email address is required.';
        } else if (!EMAIL_REGEX.test(trimmedEmail)) {
            errors.email = 'Please provide a valid email format (e.g. user@domain.com).';
        }

        if (!trimmedUser) {
            errors.username = 'Username is required.';
        } else if (!USERNAME_REGEX.test(trimmedUser)) {
            errors.username = 'Username must be 3-30 characters with letters, numbers, and underscores only.';
        }

        if (!password) {
            errors.password = 'Password is required.';
        } else if (password.length < 8) {
            errors.password = 'Password must be at least 8 characters.';
        } else if (password.length > 128) {
            errors.password = 'Password cannot exceed 128 characters.';
        }

        if (display_name && display_name.trim().length > 60) {
            errors.display_name = 'Display name cannot exceed 60 characters.';
        }

        return errors;
    }

    async handleLogin(e) {
        e.preventDefault();
        if (this.isSubmitting) return;

        const form = e.target;
        const identifier = form.identifier.value;
        const password = form.password.value;

        this.errors = this.validateLoginForm({ identifier, password });
        if (Object.keys(this.errors).length > 0) {
            this.serverAlert = null;
            this.render();
            return;
        }

        this.isSubmitting = true;
        this.serverAlert = null;
        this.render();

        try {
            const data = await apiLogin({
                identifier: identifier.trim(),
                password
            });
            authStore.setUser(data.user);
            this.serverAlert = { type: 'success', message: 'Logged in successfully! Redirecting...' };
            this.render();
            this.onAuthSuccess(data.user);
        } catch (err) {
            const msg = (err instanceof ApiError && err.message) || 'Unable to log in. Please check your network connection.';
            this.serverAlert = { type: 'danger', message: msg };
            this.isSubmitting = false;
            this.render();
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        if (this.isSubmitting) return;

        const form = e.target;
        const email = form.email.value;
        const username = form.username.value;
        const password = form.password.value;
        const display_name = form.display_name ? form.display_name.value : '';

        this.errors = this.validateRegisterForm({ email, username, password, display_name });
        if (Object.keys(this.errors).length > 0) {
            this.serverAlert = null;
            this.render();
            return;
        }

        this.isSubmitting = true;
        this.serverAlert = null;
        this.render();

        try {
            const data = await apiRegister({
                email: email.trim(),
                username: username.trim(),
                password,
                display_name: display_name.trim() || undefined
            });
            authStore.setUser(data.user);
            this.serverAlert = { type: 'success', message: 'Welcome to Frenzo! Account created successfully.' };
            this.render();
            this.onAuthSuccess(data.user);
        } catch (err) {
            const msg = (err instanceof ApiError && err.message) || 'Unable to create account. Please try again.';
            this.serverAlert = { type: 'danger', message: msg };
            this.isSubmitting = false;
            this.render();
        }
    }

    render() {
        if (!this.container) return;

        const state = authStore.state;

        // If user is already authenticated, show session profile card
        if (state.isAuthenticated && state.user) {
            this.renderAuthenticatedView(state.user);
            return;
        }

        // Render Login or Registration Form
        const isLogin = this.mode === 'login';

        this.container.innerHTML = `
            <div class="auth-container">
                <div class="auth-card" role="region" aria-label="Authentication Card">
                    <header class="auth-header">
                        <div class="auth-logo" aria-hidden="true">F</div>
                        <h1 class="auth-title">${isLogin ? 'Welcome back' : 'Join Frenzo'}</h1>
                        <p class="auth-subtitle">
                            ${isLogin ? 'Enter your credentials to access your account' : 'Where Social Meets Smart — create your account'}
                        </p>
                    </header>

                    <!-- Navigation Tabs -->
                    <div class="auth-tabs" role="tablist" aria-label="Authentication Options">
                        <button 
                            type="button" 
                            class="auth-tab-btn ${isLogin ? 'active' : ''}" 
                            role="tab" 
                            aria-selected="${isLogin}" 
                            id="tab-login"
                            aria-controls="auth-form-panel"
                        >
                            Sign In
                        </button>
                        <button 
                            type="button" 
                            class="auth-tab-btn ${!isLogin ? 'active' : ''}" 
                            role="tab" 
                            aria-selected="${!isLogin}" 
                            id="tab-register"
                            aria-controls="auth-form-panel"
                        >
                            Create Account
                        </button>
                    </div>

                    <!-- Alert Banner -->
                    ${this.serverAlert ? `
                        <div class="auth-alert auth-alert-${this.serverAlert.type}" role="alert">
                            <svg class="auth-alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                                ${this.serverAlert.type === 'danger'
                                    ? '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'
                                    : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>'
                                }
                            </svg>
                            <span>${this.escapeHtml(this.serverAlert.message)}</span>
                        </div>
                    ` : ''}

                    <!-- Form Panel -->
                    <div id="auth-form-panel" role="tabpanel" aria-labelledby="${isLogin ? 'tab-login' : 'tab-register'}">
                        ${isLogin ? this.renderLoginFormHtml() : this.renderRegisterFormHtml()}
                    </div>
                </div>

                <!-- Footer Switcher -->
                <div class="auth-footer">
                    ${isLogin ? `
                        <span>Don't have an account yet?</span>
                        <button type="button" class="auth-link" id="switch-to-register">Create account</button>
                    ` : `
                        <span>Already have an account?</span>
                        <button type="button" class="auth-link" id="switch-to-login">Sign in</button>
                    `}
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    renderLoginFormHtml() {
        return `
            <form class="auth-form" id="form-login" novalidate>
                <!-- Identifier (Username or Email) -->
                <div class="form-group">
                    <label class="form-label" for="auth-identifier">Email or Username</label>
                    <div class="form-input-wrapper">
                        <input 
                            type="text" 
                            id="auth-identifier" 
                            name="identifier" 
                            class="form-input ${this.errors.identifier ? 'has-error' : ''}" 
                            placeholder="your_handle or name@example.com"
                            autocomplete="username" 
                            autocapitalize="none"
                            spellcheck="false"
                            required
                            aria-describedby="${this.errors.identifier ? 'identifier-error' : ''}"
                        >
                    </div>
                    ${this.errors.identifier ? `<span id="identifier-error" class="form-error-text" role="alert">${this.errors.identifier}</span>` : ''}
                </div>

                <!-- Password -->
                <div class="form-group">
                    <label class="form-label" for="auth-password">Password</label>
                    <div class="form-input-wrapper">
                        <input 
                            type="${this.isPasswordVisible ? 'text' : 'password'}" 
                            id="auth-password" 
                            name="password" 
                            class="form-input ${this.errors.password ? 'has-error' : ''}" 
                            placeholder="••••••••"
                            autocomplete="current-password" 
                            required
                            aria-describedby="${this.errors.password ? 'password-error' : ''}"
                        >
                        <button 
                            type="button" 
                            class="password-toggle-btn" 
                            aria-label="${this.isPasswordVisible ? 'Hide password' : 'Show password'}"
                            tabindex="-1"
                        >
                            ${this.getPasswordIconSvg()}
                        </button>
                    </div>
                    ${this.errors.password ? `<span id="password-error" class="form-error-text" role="alert">${this.errors.password}</span>` : ''}
                </div>

                <!-- Submit Button -->
                <button type="submit" class="auth-submit-btn" ${this.isSubmitting ? 'disabled' : ''}>
                    ${this.isSubmitting ? `<span class="btn-spinner" aria-hidden="true"></span> Signing in...` : 'Sign In'}
                </button>
            </form>
        `;
    }

    renderRegisterFormHtml() {
        return `
            <form class="auth-form" id="form-register" novalidate>
                <!-- Display Name (Optional) -->
                <div class="form-group">
                    <label class="form-label" for="auth-display-name">Display Name <span class="form-helper-text">(optional)</span></label>
                    <div class="form-input-wrapper">
                        <input 
                            type="text" 
                            id="auth-display-name" 
                            name="display_name" 
                            class="form-input ${this.errors.display_name ? 'has-error' : ''}" 
                            placeholder="e.g. Alex Morgan"
                            autocomplete="name" 
                            maxlength="60"
                        >
                    </div>
                    ${this.errors.display_name ? `<span class="form-error-text" role="alert">${this.errors.display_name}</span>` : ''}
                </div>

                <!-- Username (Required) -->
                <div class="form-group">
                    <label class="form-label" for="auth-username">Username</label>
                    <div class="form-input-wrapper">
                        <input 
                            type="text" 
                            id="auth-username" 
                            name="username" 
                            class="form-input ${this.errors.username ? 'has-error' : ''}" 
                            placeholder="e.g. alex_morgan"
                            autocomplete="username" 
                            autocapitalize="none"
                            spellcheck="false"
                            required
                            aria-describedby="username-hint ${this.errors.username ? 'username-error' : ''}"
                        >
                    </div>
                    <span id="username-hint" class="form-helper-text">3-30 letters, numbers, and underscores.</span>
                    ${this.errors.username ? `<span id="username-error" class="form-error-text" role="alert">${this.errors.username}</span>` : ''}
                </div>

                <!-- Email (Required) -->
                <div class="form-group">
                    <label class="form-label" for="auth-email">Email Address</label>
                    <div class="form-input-wrapper">
                        <input 
                            type="email" 
                            id="auth-email" 
                            name="email" 
                            class="form-input ${this.errors.email ? 'has-error' : ''}" 
                            placeholder="alex@example.com"
                            autocomplete="email" 
                            autocapitalize="none"
                            spellcheck="false"
                            required
                            aria-describedby="${this.errors.email ? 'email-error' : ''}"
                        >
                    </div>
                    ${this.errors.email ? `<span id="email-error" class="form-error-text" role="alert">${this.errors.email}</span>` : ''}
                </div>

                <!-- Password (Required) -->
                <div class="form-group">
                    <label class="form-label" for="auth-password">Password</label>
                    <div class="form-input-wrapper">
                        <input 
                            type="${this.isPasswordVisible ? 'text' : 'password'}" 
                            id="auth-password" 
                            name="password" 
                            class="form-input ${this.errors.password ? 'has-error' : ''}" 
                            placeholder="Minimum 8 characters"
                            autocomplete="new-password" 
                            required
                            aria-describedby="pwd-hint ${this.errors.password ? 'password-error' : ''}"
                        >
                        <button 
                            type="button" 
                            class="password-toggle-btn" 
                            aria-label="${this.isPasswordVisible ? 'Hide password' : 'Show password'}"
                            tabindex="-1"
                        >
                            ${this.getPasswordIconSvg()}
                        </button>
                    </div>
                    <span id="pwd-hint" class="form-helper-text">At least 8 characters.</span>
                    ${this.errors.password ? `<span id="password-error" class="form-error-text" role="alert">${this.errors.password}</span>` : ''}
                </div>

                <!-- Submit Button -->
                <button type="submit" class="auth-submit-btn" ${this.isSubmitting ? 'disabled' : ''}>
                    ${this.isSubmitting ? `<span class="btn-spinner" aria-hidden="true"></span> Creating account...` : 'Create Account'}
                </button>
            </form>
        `;
    }

    renderAuthenticatedView(user) {
        const initials = (user.display_name || user.username || 'F')
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);

        this.container.innerHTML = `
            <div class="auth-container">
                <div class="auth-session-card" role="region" aria-label="Authenticated Session">
                    <div class="session-user-header">
                        <div class="session-avatar">${initials}</div>
                        <div class="session-details">
                            <div class="session-display-name">${this.escapeHtml(user.display_name || user.username)}</div>
                            <div class="session-username">@${this.escapeHtml(user.username)}</div>
                            <span class="session-badge" style="margin-top: 4px;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                Active Session
                            </span>
                        </div>
                    </div>

                    <div style="display: flex; gap: var(--space-4); padding: var(--space-3) 0; border-top: 1px solid var(--color-border-subtle); border-bottom: 1px solid var(--color-border-subtle);">
                        <div>
                            <span style="font-size: var(--font-size-xs); color: var(--color-text-muted);">Followers</span>
                            <div style="font-weight: var(--font-weight-bold);">${user.followers_count || 0}</div>
                        </div>
                        <div>
                            <span style="font-size: var(--font-size-xs); color: var(--color-text-muted);">Following</span>
                            <div style="font-weight: var(--font-weight-bold);">${user.following_count || 0}</div>
                        </div>
                        <div>
                            <span style="font-size: var(--font-size-xs); color: var(--color-text-muted);">Posts</span>
                            <div style="font-weight: var(--font-weight-bold);">${user.posts_count || 0}</div>
                        </div>
                    </div>

                    <button type="button" class="session-logout-btn" id="btn-session-logout">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                        Sign Out of Frenzo
                    </button>
                </div>
            </div>
        `;

        const logoutBtn = this.container.querySelector('#btn-session-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                logoutBtn.disabled = true;
                logoutBtn.innerHTML = '<span class="btn-spinner" style="border-top-color: var(--color-danger); border-color: rgba(239,68,68,0.2);"></span> Signing out...';
                await authStore.logout();
            });
        }
    }

    attachEventListeners() {
        // Tab buttons
        const tabLogin = this.container.querySelector('#tab-login');
        const tabRegister = this.container.querySelector('#tab-register');
        if (tabLogin) tabLogin.addEventListener('click', () => this.setMode('login'));
        if (tabRegister) tabRegister.addEventListener('click', () => this.setMode('register'));

        // Footer links
        const switchToRegister = this.container.querySelector('#switch-to-register');
        const switchToLogin = this.container.querySelector('#switch-to-login');
        if (switchToRegister) switchToRegister.addEventListener('click', () => this.setMode('register'));
        if (switchToLogin) switchToLogin.addEventListener('click', () => this.setMode('login'));

        // Password visibility toggle
        const toggleBtn = this.container.querySelector('.password-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.togglePasswordVisibility());
        }

        // Form submission
        const loginForm = this.container.querySelector('#form-login');
        const registerForm = this.container.querySelector('#form-register');
        if (loginForm) loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        if (registerForm) registerForm.addEventListener('submit', (e) => this.handleRegister(e));
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
