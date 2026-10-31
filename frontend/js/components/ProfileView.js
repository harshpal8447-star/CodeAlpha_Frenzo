/**
 * Frenzo User Profile View Component (Phase 3.2)
 * Handles own-profile viewing and editing, public profile inspection,
 * real-time follower/following counts, follow/unfollow actions, and empty states.
 */
import { getProfile, updateProfile, followUser, unfollowUser } from '../api/userApi.js';
import { authStore } from '../state/authStore.js';
import { ApiError } from '../api/client.js';

export class ProfileView {
    /**
     * @param {HTMLElement} container - DOM mount element
     * @param {object} options - { username: string, onNavigate: Function }
     */
    constructor(container, options = {}) {
        this.container = container;
        this.username = options.username || null;
        this.onNavigate = options.onNavigate || (() => {});
        this.profile = null;
        this.isLoading = true;
        this.isEditing = false;
        this.isSaving = false;
        this.isTogglingFollow = false;
        this.error = null;
        this.editErrors = {};
        this.serverAlert = null;
    }

    async init() {
        await this.loadProfile();
    }

    async setUsername(username) {
        if (this.username === username && this.profile) return;
        this.username = username;
        this.isEditing = false;
        this.serverAlert = null;
        this.editErrors = {};
        await this.loadProfile();
    }

    async loadProfile() {
        this.isLoading = true;
        this.error = null;
        this.render();

        try {
            // If no username provided, resolve to current authenticated user
            let targetUsername = this.username;
            if (!targetUsername) {
                const currentUser = authStore.state.user;
                if (!currentUser) {
                    this.error = 'Please sign in to view your profile.';
                    this.isLoading = false;
                    this.render();
                    return;
                }
                targetUsername = currentUser.username;
            }

            const profile = await getProfile(targetUsername);
            this.profile = profile;
            this.isLoading = false;
            this.render();
        } catch (err) {
            this.isLoading = false;
            this.error = (err instanceof ApiError && err.message) || 'Unable to load profile. Please try again.';
            this.render();
        }
    }

    async handleFollowToggle() {
        if (!authStore.state.isAuthenticated) {
            window.location.hash = '#login';
            return;
        }

        if (this.isTogglingFollow || !this.profile) return;
        this.isTogglingFollow = true;
        this.render();

        try {
            if (this.profile.is_following) {
                const res = await unfollowUser(this.profile.username);
                this.profile.is_following = false;
                this.profile.followers_count = res.target_followers_count !== undefined 
                    ? res.target_followers_count 
                    : Math.max(0, this.profile.followers_count - 1);
            } else {
                const res = await followUser(this.profile.username);
                this.profile.is_following = true;
                this.profile.followers_count = res.target_followers_count !== undefined 
                    ? res.target_followers_count 
                    : this.profile.followers_count + 1;
            }
        } catch (err) {
            const msg = (err instanceof ApiError && err.message) || 'Failed to update follow status.';
            this.serverAlert = { type: 'danger', message: msg };
        } finally {
            this.isTogglingFollow = false;
            this.render();
        }
    }

    async handleSaveProfile(e) {
        e.preventDefault();
        if (this.isSaving) return;

        const form = e.target;
        const display_name = form.display_name.value.trim();
        const username = form.username.value.trim().toLowerCase();
        const bio = form.bio.value.trim();

        this.editErrors = {};

        if (!display_name) {
            this.editErrors.display_name = 'Display name cannot be empty.';
        } else if (display_name.length > 60) {
            this.editErrors.display_name = 'Display name cannot exceed 60 characters.';
        }

        if (!username) {
            this.editErrors.username = 'Username cannot be empty.';
        } else if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
            this.editErrors.username = 'Username must be 3-30 letters, numbers, or underscores.';
        }

        if (bio.length > 300) {
            this.editErrors.bio = 'Bio cannot exceed 300 characters.';
        }

        if (Object.keys(this.editErrors).length > 0) {
            this.render();
            return;
        }

        this.isSaving = true;
        this.serverAlert = null;
        this.render();

        try {
            const updated = await updateProfile({
                display_name,
                username,
                bio: bio || null
            });

            this.profile = {
                ...this.profile,
                ...updated
            };

            // Update global auth store user representation
            const currentUser = authStore.state.user;
            if (currentUser && currentUser.id === updated.id) {
                authStore.setUser({
                    ...currentUser,
                    display_name: updated.display_name,
                    username: updated.username
                });
            }

            this.isEditing = false;
            this.serverAlert = { type: 'success', message: 'Profile updated successfully.' };

            // If username changed, update browser hash URL cleanly
            if (username !== this.username) {
                this.username = username;
                window.location.hash = `#profile/${username}`;
            }
        } catch (err) {
            const msg = (err instanceof ApiError && err.message) || 'Failed to update profile.';
            this.serverAlert = { type: 'danger', message: msg };
        } finally {
            this.isSaving = false;
            this.render();
        }
    }

    render() {
        if (!this.container) return;

        if (this.isLoading) {
            this.container.innerHTML = `
                <div class="profile-container">
                    <div class="profile-card" style="padding: var(--space-8); text-align: center; color: var(--color-text-muted);">
                        <span class="btn-spinner" style="margin: 0 auto var(--space-3); border-color: rgba(99,102,241,0.2); border-top-color: var(--color-primary-violet);"></span>
                        <p class="text-sm">Loading profile...</p>
                    </div>
                </div>
            `;
            return;
        }

        if (this.error) {
            this.container.innerHTML = `
                <div class="profile-container">
                    <div class="profile-card" style="padding: var(--space-8); text-align: center;">
                        <div style="font-size: 2rem; margin-bottom: 8px;">🔍</div>
                        <h3 class="h3" style="margin-bottom: 8px;">Profile Not Found</h3>
                        <p class="text-sm text-muted" style="margin-bottom: var(--space-4);">${this.error}</p>
                        <a href="#explore" class="profile-action-btn profile-action-btn-primary" style="text-decoration: none;">Explore Creators</a>
                    </div>
                </div>
            `;
            return;
        }

        const p = this.profile;
        const initials = (p.display_name || p.username || 'F')
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);

        const joinedDate = new Date(p.created_at).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });

        this.container.innerHTML = `
            <div class="profile-container">
                <!-- Alert Banner -->
                ${this.serverAlert ? `
                    <div class="auth-alert auth-alert-${this.serverAlert.type}" role="alert" style="margin-bottom: var(--space-2);">
                        ${this.serverAlert.message}
                    </div>
                ` : ''}

                <!-- Main Profile Header Card -->
                <div class="profile-card">
                    <div class="profile-banner-wrapper"></div>
                    
                    <div class="profile-details-wrapper">
                        <div class="profile-avatar-row">
                            <div class="profile-avatar-large" aria-label="${p.display_name || p.username} avatar">
                                ${initials}
                            </div>
                            
                            <div class="profile-actions-mount">
                                ${p.is_own_profile ? `
                                    <button type="button" class="profile-action-btn profile-action-btn-secondary" id="btn-edit-profile">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                        ${this.isEditing ? 'Cancel Editing' : 'Edit Profile'}
                                    </button>
                                ` : `
                                    <button 
                                        type="button" 
                                        class="profile-action-btn ${p.is_following ? 'profile-action-btn-following' : 'profile-action-btn-primary'}" 
                                        id="btn-follow-toggle"
                                        ${this.isTogglingFollow ? 'disabled' : ''}
                                    >
                                        ${this.isTogglingFollow 
                                            ? '<span class="btn-spinner" style="width: 14px; height: 14px; border-top-color: currentColor;"></span>' 
                                            : (p.is_following ? 'Following' : 'Follow')}
                                    </button>
                                `}
                            </div>
                        </div>

                        <!-- Identity Names -->
                        <div class="profile-names">
                            <div class="profile-display-name">
                                <span>${p.display_name}</span>
                                ${p.is_private ? `<span class="bunni-badge" title="Private Account">Private</span>` : ''}
                            </div>
                            <div class="profile-handle">@${p.username}</div>
                        </div>

                        <!-- Bio -->
                        <div class="profile-bio">${p.bio || 'No bio yet.'}</div>

                        <!-- Meta Info (Joined Date & Website) -->
                        <div class="profile-meta-row">
                            <div class="profile-meta-item">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                <span>Joined ${joinedDate}</span>
                            </div>
                            ${p.website ? `
                                <div class="profile-meta-item">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                                    <a href="${p.website}" target="_blank" rel="noopener noreferrer" class="profile-meta-link">${p.website.replace(/^https?:\/\//, '')}</a>
                                </div>
                            ` : ''}
                        </div>

                        <!-- Counts -->
                        <div class="profile-stats-row">
                            <div class="stat-item">
                                <span class="stat-number">${p.posts_count || 0}</span>
                                <span class="stat-label">Posts</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-number" id="profile-followers-count">${p.followers_count || 0}</span>
                                <span class="stat-label">Followers</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-number">${p.following_count || 0}</span>
                                <span class="stat-label">Following</span>
                            </div>
                        </div>

                        <!-- Edit Profile Inline Panel -->
                        ${this.isEditing ? `
                            <div class="profile-edit-box">
                                <h4 class="font-bold text-sm" style="margin-bottom: var(--space-3); color: var(--color-midnight-navy);">Edit Profile</h4>
                                <form id="profile-edit-form" class="edit-form-grid" novalidate>
                                    <div class="form-group">
                                        <label class="form-label" for="edit-display-name">Display Name</label>
                                        <input 
                                            type="text" 
                                            class="form-input ${this.editErrors.display_name ? 'input-error' : ''}" 
                                            id="edit-display-name" 
                                            name="display_name" 
                                            value="${p.display_name}" 
                                            maxlength="60"
                                            required
                                        >
                                        ${this.editErrors.display_name ? `<div class="field-error-msg">${this.editErrors.display_name}</div>` : ''}
                                    </div>

                                    <div class="form-group">
                                        <label class="form-label" for="edit-username">Username</label>
                                        <input 
                                            type="text" 
                                            class="form-input ${this.editErrors.username ? 'input-error' : ''}" 
                                            id="edit-username" 
                                            name="username" 
                                            value="${p.username}" 
                                            maxlength="30"
                                            required
                                        >
                                        ${this.editErrors.username ? `<div class="field-error-msg">${this.editErrors.username}</div>` : ''}
                                    </div>

                                    <div class="form-group">
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <label class="form-label" for="edit-bio">Bio</label>
                                            <span class="text-xs text-muted" id="bio-char-count">${(p.bio || '').length}/300</span>
                                        </div>
                                        <textarea 
                                            class="form-input ${this.editErrors.bio ? 'input-error' : ''}" 
                                            id="edit-bio" 
                                            name="bio" 
                                            rows="3" 
                                            maxlength="300"
                                            style="resize: vertical; font-family: inherit;"
                                        >${p.bio || ''}</textarea>
                                        ${this.editErrors.bio ? `<div class="field-error-msg">${this.editErrors.bio}</div>` : ''}
                                    </div>

                                    <div style="display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2);">
                                        <button type="button" class="profile-action-btn profile-action-btn-secondary" id="btn-cancel-edit">Cancel</button>
                                        <button type="submit" class="profile-action-btn profile-action-btn-primary" ${this.isSaving ? 'disabled' : ''}>
                                            ${this.isSaving ? '<span class="btn-spinner" style="width: 14px; height: 14px; border-top-color: white;"></span> Saving...' : 'Save Changes'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        ` : ''}
                    </div>
                </div>

                <!-- Empty Posts Stream State -->
                <div class="profile-empty-state">
                    <div class="empty-icon-circle">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    </div>
                    <h3 class="font-bold text-base" style="color: var(--color-midnight-navy);">No posts yet</h3>
                    <p class="text-sm text-muted" style="max-width: 320px;">
                        ${p.is_own_profile ? 'When you share thoughts, updates, and media, they will appear here.' : `When @${p.username} shares posts, they will appear here.`}
                    </p>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        const editBtn = this.container.querySelector('#btn-edit-profile');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                this.isEditing = !this.isEditing;
                this.serverAlert = null;
                this.editErrors = {};
                this.render();
            });
        }

        const cancelEditBtn = this.container.querySelector('#btn-cancel-edit');
        if (cancelEditBtn) {
            cancelEditBtn.addEventListener('click', () => {
                this.isEditing = false;
                this.editErrors = {};
                this.serverAlert = null;
                this.render();
            });
        }

        const editForm = this.container.querySelector('#profile-edit-form');
        if (editForm) {
            editForm.addEventListener('submit', (e) => this.handleSaveProfile(e));

            const bioInput = editForm.querySelector('#edit-bio');
            const bioCount = editForm.querySelector('#bio-char-count');
            if (bioInput && bioCount) {
                bioInput.addEventListener('input', () => {
                    bioCount.textContent = `${bioInput.value.length}/300`;
                });
            }
        }

        const followBtn = this.container.querySelector('#btn-follow-toggle');
        if (followBtn) {
            followBtn.addEventListener('click', () => this.handleFollowToggle());
        }
    }
}
