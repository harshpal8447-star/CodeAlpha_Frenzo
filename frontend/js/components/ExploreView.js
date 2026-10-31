/**
 * Frenzo Explore & User Discovery Component (Phase 3.2)
 * Provides instant debounced user search, result cards, and profile navigation.
 */
import { searchUsers } from '../api/userApi.js';
import { ApiError } from '../api/client.js';

export class ExploreView {
    /**
     * @param {HTMLElement} container - DOM mount element
     * @param {object} options - { onSelectUser: Function }
     */
    constructor(container, options = {}) {
        this.container = container;
        this.onSelectUser = options.onSelectUser || (() => {});
        this.query = '';
        this.results = [];
        this.isSearching = false;
        this.hasSearched = false;
        this.error = null;
        this.debounceTimer = null;
    }

    init() {
        this.render();
    }

    handleSearchInput(e) {
        const val = e.target.value;
        this.query = val;

        clearTimeout(this.debounceTimer);

        if (!val.trim()) {
            this.results = [];
            this.hasSearched = false;
            this.isSearching = false;
            this.error = null;
            this.render();
            return;
        }

        this.isSearching = true;
        this.render();

        this.debounceTimer = setTimeout(async () => {
            try {
                const users = await searchUsers(val, 20);
                this.results = users;
                this.hasSearched = true;
                this.error = null;
            } catch (err) {
                this.error = (err instanceof ApiError && err.message) || 'Failed to search users.';
            } finally {
                this.isSearching = false;
                this.render();
            }
        }, 250);
    }

    handleClearSearch() {
        this.query = '';
        this.results = [];
        this.hasSearched = false;
        this.isSearching = false;
        this.error = null;
        this.render();
    }

    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="explore-container">
                <!-- Search Input Card -->
                <div class="search-box-card">
                    <div class="search-input-wrapper">
                        <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input 
                            type="search" 
                            class="search-input" 
                            id="explore-search-input" 
                            placeholder="Search by username or display name..." 
                            value="${this.query}" 
                            autocomplete="off"
                            aria-label="Search users"
                        >
                        ${this.query ? `
                            <button type="button" class="search-clear-btn" id="explore-clear-btn" title="Clear search" aria-label="Clear search">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        ` : ''}
                    </div>
                </div>

                <!-- Error Alert -->
                ${this.error ? `
                    <div class="auth-alert auth-alert-danger" role="alert">
                        ${this.error}
                    </div>
                ` : ''}

                <!-- Search Results Section -->
                ${this.isSearching ? `
                    <div class="explore-empty-state">
                        <span class="btn-spinner" style="border-color: rgba(99,102,241,0.2); border-top-color: var(--color-primary-violet); width: 24px; height: 24px;"></span>
                        <p class="text-sm text-muted">Searching creators...</p>
                    </div>
                ` : this.hasSearched ? (
                    this.results.length > 0 ? `
                        <div class="search-results-section">
                            <div class="search-results-header">Matching Creators (${this.results.length})</div>
                            ${this.results.map((u) => {
                                const initials = (u.display_name || u.username || 'F')
                                    .split(' ')
                                    .map(n => n[0])
                                    .join('')
                                    .toUpperCase()
                                    .substring(0, 2);
                                return `
                                    <a href="#profile/${encodeURIComponent(u.username)}" class="search-user-card" data-username="${u.username}">
                                        <div class="search-user-info">
                                            <div class="search-user-avatar">${initials}</div>
                                            <div class="search-user-meta">
                                                <div class="search-user-name">
                                                    ${u.display_name}
                                                    ${u.is_private ? `<span class="bunni-badge" style="font-size: 10px; padding: 1px 6px;">Private</span>` : ''}
                                                </div>
                                                <div class="search-user-handle">@${u.username}</div>
                                                ${u.bio ? `<div class="search-user-bio">${u.bio}</div>` : ''}
                                            </div>
                                        </div>
                                        <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); flex-shrink: 0; text-align: right;">
                                            <span style="font-weight: var(--font-weight-bold); color: var(--color-text-main);">${u.followers_count || 0}</span> followers
                                        </div>
                                    </a>
                                `;
                            }).join('')}
                        </div>
                    ` : `
                        <div class="explore-empty-state">
                            <div style="font-size: 2rem;">🔍</div>
                            <h3 class="font-bold text-base" style="color: var(--color-midnight-navy);">No creators found</h3>
                            <p class="text-sm text-muted">No accounts match "${this.query}". Try another username or display name.</p>
                        </div>
                    `
                ) : `
                    <div class="explore-empty-state">
                        <div style="font-size: 2.2rem; margin-bottom: 4px;">✨</div>
                        <h3 class="font-bold text-base" style="color: var(--color-midnight-navy);">Discover Frenzo Community</h3>
                        <p class="text-sm text-muted" style="max-width: 340px;">
                            Search for friends, creators, and interesting thinkers across the platform.
                        </p>
                    </div>
                `}
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        const input = this.container.querySelector('#explore-search-input');
        if (input) {
            input.addEventListener('input', (e) => this.handleSearchInput(e));
            // Keep focus if user was typing
            if (this.query && document.activeElement !== input) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        }

        const clearBtn = this.container.querySelector('#explore-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.handleClearSearch());
        }
    }
}
