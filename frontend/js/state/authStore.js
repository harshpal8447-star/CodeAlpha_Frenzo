/**
 * Reactive Authentication State Store (In-Memory Only)
 * Holds authenticated user session state without storing tokens in localStorage/sessionStorage.
 * Notifies subscribed UI components upon state transitions.
 */
import { getCurrentUser, logout as apiLogout } from '../api/authApi.js';
import { setSessionExpiredHandler } from '../api/client.js';

class AuthStore {
    constructor() {
        this.state = {
            user: null,
            isAuthenticated: false,
            isLoading: true
        };
        this.listeners = new Set();

        // Automatically clear in-memory credentials if session refresh fails
        setSessionExpiredHandler(() => {
            this.clearUser();
        });
    }

    /**
     * Subscribes a callback to auth state changes.
     * @param {Function} listener - Callback function(state)
     * @returns {Function} Unsubscribe function
     */
    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    }

    /**
     * Broadcasts current state to all subscribers.
     */
    notify() {
        for (const listener of this.listeners) {
            listener(this.state);
        }
    }

    /**
     * Initializes session state by probing /api/v1/auth/me on app boot.
     */
    async init() {
        this.state.isLoading = true;
        this.notify();

        try {
            const user = await getCurrentUser();
            if (user) {
                this.state.user = user;
                this.state.isAuthenticated = true;
            } else {
                this.state.user = null;
                this.state.isAuthenticated = false;
            }
        } catch {
            this.state.user = null;
            this.state.isAuthenticated = false;
        } finally {
            this.state.isLoading = false;
            this.notify();
        }
    }

    /**
     * Updates session after successful login or registration.
     * @param {object} user - User profile object from backend
     */
    setUser(user) {
        this.state.user = user;
        this.state.isAuthenticated = true;
        this.state.isLoading = false;
        this.notify();
    }

    /**
     * Clears session locally and notifies subscribers.
     */
    clearUser() {
        this.state.user = null;
        this.state.isAuthenticated = false;
        this.state.isLoading = false;
        this.notify();
    }

    /**
     * Executes backend session termination and clears local state.
     */
    async logout() {
        this.state.isLoading = true;
        this.notify();

        try {
            await apiLogout();
        } finally {
            this.clearUser();
        }
    }
}

export const authStore = new AuthStore();
