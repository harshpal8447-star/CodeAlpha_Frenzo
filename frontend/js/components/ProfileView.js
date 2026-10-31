/**
 * Frenzo User Profile & Posts Stream Component (Phase 3.3.4)
 * Handles own-profile viewing/editing, public profile inspection,
 * social connections, post composing, timeline rendering, editing, and soft-deletion.
 */
import { getProfile, updateProfile, followUser, unfollowUser } from '../api/userApi.js';
import { createPost, getUserPosts, updatePost, deletePost } from '../api/postApi.js';
import { authStore } from '../state/authStore.js';
import { ApiError } from '../api/client.js';

/**
 * Escapes HTML entities to defend against XSS in string interpolation.
 */
const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

/**
 * Formats timestamps into human-readable relative intervals.
 */
const formatRelativeTime = (dateInput) => {
    try {
        const date = new Date(dateInput);
        const now = new Date();
        const diffMs = now - date;
        const diffSecs = Math.max(0, Math.floor(diffMs / 1000));

        if (diffSecs < 60) return 'Just now';
        const diffMins = Math.floor(diffSecs / 60);
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return `${diffDays}d ago`;

        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    } catch {
        return '';
    }
};

/**
 * Formats absolute date for tooltip title.
 */
const formatFullDate = (dateInput) => {
    try {
        return new Date(dateInput).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    } catch {
        return '';
    }
};

export class ProfileView {
    /**
     * @param {HTMLElement} container - DOM mount element
     * @param {object} options - { username: string, onNavigate: Function }
     */
    constructor(container, options = {}) {
        this.container = container;
        this.username = options.username || null;
        this.onNavigate = options.onNavigate || (() => {});

        // Profile State
        this.profile = null;
        this.isLoading = true;
        this.isEditing = false;
        this.isSaving = false;
        this.isTogglingFollow = false;
        this.error = null;
        this.editErrors = {};
        this.serverAlert = null;

        // Posts State
        this.posts = [];
        this.postsLoading = false;
        this.postsError = null;
        this.postsRestricted = false;
        this.pagination = null;
        this.isLoadingMore = false;

        // Composer State
        this.composerText = '';
        this.isPublishing = false;
        this.composerError = null;

        // Post Edit State
        this.editingPostId = null;
        this.editingText = '';
        this.editPostError = null;
        this.isSavingEdit = false;

        // Post Delete Confirmation State
        this.deleteConfirmPostId = null;
        this.isDeleting = false;
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

        // Reset posts & composer state
        this.posts = [];
        this.postsLoading = true;
        this.postsError = null;
        this.postsRestricted = false;
        this.pagination = null;
        this.composerText = '';
        this.composerError = null;
        this.editingPostId = null;
        this.deleteConfirmPostId = null;

        await this.loadProfile();
    }

    async loadProfile() {
        this.isLoading = true;
        this.error = null;
        this.render();

        try {
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

            // Load Posts Timeline
            if (this.profile.is_restricted) {
                this.postsRestricted = true;
                this.postsLoading = false;
                this.renderPostsSection();
            } else {
                await this.loadPosts({ page: 1, append: false });
            }
        } catch (err) {
            this.isLoading = false;
            this.error = (err instanceof ApiError && err.message) || 'Unable to load profile. Please try again.';
            this.render();
        }
    }

    async loadPosts({ page = 1, append = false } = {}) {
        if (append) {
            this.isLoadingMore = true;
        } else {
            this.postsLoading = true;
            this.postsError = null;
            this.postsRestricted = false;
        }
        this.renderPostsSection();

        try {
            const data = await getUserPosts(this.profile.username, { page, limit: 10 });
            if (append) {
                this.posts = [...this.posts, ...data.posts];
            } else {
                this.posts = data.posts;
            }
            this.pagination = data.pagination;

            // Synchronize profile posts counter if returned
            if (data.pagination && data.pagination.total !== undefined) {
                this.profile.posts_count = data.pagination.total;
                const counterEl = this.container.querySelector('#profile-posts-count');
                if (counterEl) {
                    counterEl.textContent = this.profile.posts_count;
                }
            }
        } catch (err) {
            if (err instanceof ApiError && (err.code === 'PRIVATE_PROFILE' || err.status === 403)) {
                this.postsRestricted = true;
                this.posts = [];
            } else {
                this.postsError = (err instanceof ApiError && err.message) || 'Failed to load posts.';
            }
        } finally {
            this.postsLoading = false;
            this.isLoadingMore = false;
            this.renderPostsSection();
        }
    }

    async handleFollowToggle() {
        if (!authStore.state.isAuthenticated) {
            window.location.hash = '#login';
            return;
        }

        if (this.isTogglingFollow || !this.profile) return;
        this.isTogglingFollow = true;
        this.renderProfileCard();

        try {
            if (this.profile.is_following) {
                const res = await unfollowUser(this.profile.username);
                this.profile.is_following = false;
                this.profile.followers_count = res.target_followers_count !== undefined 
                    ? res.target_followers_count 
                    : Math.max(0, this.profile.followers_count - 1);

                // If account is private, restrict posts view upon unfollowing
                if (this.profile.is_private) {
                    this.postsRestricted = true;
                    this.posts = [];
                }
            } else {
                const res = await followUser(this.profile.username);
                this.profile.is_following = true;
                this.profile.followers_count = res.target_followers_count !== undefined 
                    ? res.target_followers_count 
                    : this.profile.followers_count + 1;

                // If account was restricted, reload posts now that viewer is following
                if (this.postsRestricted) {
                    this.postsRestricted = false;
                    await this.loadPosts({ page: 1 });
                }
            }
        } catch (err) {
            const msg = (err instanceof ApiError && err.message) || 'Failed to update follow status.';
            this.serverAlert = { type: 'danger', message: msg };
            this.renderAlert();
        } finally {
            this.isTogglingFollow = false;
            this.renderProfileCard();
            this.renderPostsSection();
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
            this.renderProfileCard();
            return;
        }

        this.isSaving = true;
        this.serverAlert = null;
        this.renderProfileCard();

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

    async handleCreatePost(e) {
        e.preventDefault();
        if (this.isPublishing) return;

        const form = e.target;
        const textarea = form.querySelector('#composer-input');
        const content = textarea ? textarea.value.trim() : '';

        if (!content) {
            this.composerError = 'Post content cannot be empty.';
            this.renderComposer();
            return;
        }

        if (content.length > 2000) {
            this.composerError = 'Post content cannot exceed 2,000 characters.';
            this.renderComposer();
            return;
        }

        this.isPublishing = true;
        this.composerError = null;
        this.renderComposer();

        try {
            const newPost = await createPost({ content });

            // Insert new post at top of timeline
            this.posts.unshift(newPost);
            this.profile.posts_count = (this.profile.posts_count || 0) + 1;

            if (this.pagination) {
                this.pagination.total = (this.pagination.total || 0) + 1;
                this.pagination.count = this.posts.length;
            }

            // Sync counter in profile card
            const counterEl = this.container.querySelector('#profile-posts-count');
            if (counterEl) {
                counterEl.textContent = this.profile.posts_count;
            }

            // Reset composer
            this.composerText = '';
            this.serverAlert = { type: 'success', message: 'Post published successfully!' };
            this.renderAlert();
            this.renderComposer();
            this.renderPostsSection();

            // Auto-clear alert after 3.5s
            setTimeout(() => {
                this.serverAlert = null;
                this.renderAlert();
            }, 3500);
        } catch (err) {
            this.composerError = (err instanceof ApiError && err.message) || 'Failed to publish post. Please try again.';
            this.renderComposer();
        } finally {
            this.isPublishing = false;
            this.renderComposer();
        }
    }

    async handleSaveEdit(postId, content) {
        if (this.isSavingEdit) return;

        const trimmed = (content || '').trim();
        if (!trimmed) {
            this.editPostError = 'Post content cannot be empty.';
            this.renderPostsSection();
            return;
        }

        if (trimmed.length > 2000) {
            this.editPostError = 'Post content cannot exceed 2,000 characters.';
            this.renderPostsSection();
            return;
        }

        this.isSavingEdit = true;
        this.editPostError = null;
        this.renderPostsSection();

        try {
            const updated = await updatePost(postId, { content: trimmed });
            
            // Update local post state
            this.posts = this.posts.map(p => (p.id === postId ? updated : p));
            this.editingPostId = null;
            this.editingText = '';

            this.serverAlert = { type: 'success', message: 'Post updated successfully.' };
            this.renderAlert();
            this.renderPostsSection();

            setTimeout(() => {
                this.serverAlert = null;
                this.renderAlert();
            }, 3500);
        } catch (err) {
            this.editPostError = (err instanceof ApiError && err.message) || 'Failed to update post.';
            this.renderPostsSection();
        } finally {
            this.isSavingEdit = false;
        }
    }

    async handleConfirmDelete(postId) {
        if (this.isDeleting) return;
        this.isDeleting = true;

        try {
            await deletePost(postId);

            // Remove post from timeline list
            this.posts = this.posts.filter(p => p.id !== postId);
            this.profile.posts_count = Math.max(0, (this.profile.posts_count || 1) - 1);

            if (this.pagination) {
                this.pagination.total = Math.max(0, (this.pagination.total || 1) - 1);
                this.pagination.count = this.posts.length;
            }

            // Sync counter in profile card
            const counterEl = this.container.querySelector('#profile-posts-count');
            if (counterEl) {
                counterEl.textContent = this.profile.posts_count;
            }

            this.deleteConfirmPostId = null;
            this.serverAlert = { type: 'success', message: 'Post deleted successfully.' };
            this.renderAlert();
            this.renderPostsSection();

            setTimeout(() => {
                this.serverAlert = null;
                this.renderAlert();
            }, 3500);
        } catch (err) {
            this.serverAlert = { type: 'danger', message: (err instanceof ApiError && err.message) || 'Failed to delete post.' };
            this.deleteConfirmPostId = null;
            this.renderAlert();
            this.renderPostsSection();
        } finally {
            this.isDeleting = false;
        }
    }

    // =========================================================================
    // DOM Rendering Engine
    // =========================================================================

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
                        <p class="text-sm text-muted" style="margin-bottom: var(--space-4);">${escapeHtml(this.error)}</p>
                        <a href="#explore" class="profile-action-btn profile-action-btn-primary" style="text-decoration: none;">Explore Creators</a>
                    </div>
                </div>
            `;
            return;
        }

        this.container.innerHTML = `
            <div class="profile-container">
                <div id="profile-alert-mount"></div>
                <div id="profile-card-mount"></div>
                <div id="profile-posts-mount" class="posts-section"></div>
            </div>
        `;

        this.renderAlert();
        this.renderProfileCard();
        this.renderPostsSection();
    }

    renderAlert() {
        const mount = this.container.querySelector('#profile-alert-mount');
        if (!mount) return;

        if (!this.serverAlert) {
            mount.innerHTML = '';
            return;
        }

        mount.innerHTML = `
            <div class="auth-alert auth-alert-${this.serverAlert.type}" role="alert" style="margin-bottom: var(--space-2);">
                ${escapeHtml(this.serverAlert.message)}
            </div>
        `;
    }

    renderProfileCard() {
        const mount = this.container.querySelector('#profile-card-mount');
        if (!mount || !this.profile) return;

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

        mount.innerHTML = `
            <div class="profile-card">
                <div class="profile-banner-wrapper"></div>
                
                <div class="profile-details-wrapper">
                    <div class="profile-avatar-row">
                        <div class="profile-avatar-large" aria-label="${escapeHtml(p.display_name || p.username)} avatar">
                            ${escapeHtml(initials)}
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
                            <span>${escapeHtml(p.display_name)}</span>
                            ${p.is_private ? `<span class="bunni-badge" title="Private Account">Private</span>` : ''}
                        </div>
                        <div class="profile-handle">@${escapeHtml(p.username)}</div>
                    </div>

                    <!-- Bio -->
                    <div class="profile-bio">${escapeHtml(p.bio || 'No bio yet.')}</div>

                    <!-- Meta Info (Joined Date & Website) -->
                    <div class="profile-meta-row">
                        <div class="profile-meta-item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                            <span>Joined ${joinedDate}</span>
                        </div>
                        ${p.website ? `
                            <div class="profile-meta-item">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"></path></svg>
                                <a href="${escapeHtml(p.website)}" target="_blank" rel="noopener noreferrer" class="profile-meta-link">${escapeHtml(p.website.replace(/^https?:\/\//, ''))}</a>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Stats Row -->
                    <div class="profile-stats-row">
                        <div class="stat-item">
                            <span class="stat-number" id="profile-posts-count">${p.posts_count || 0}</span>
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

                    <!-- Inline Profile Edit Box -->
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
                                        value="${escapeHtml(p.display_name)}" 
                                        maxlength="60"
                                        required
                                    >
                                    ${this.editErrors.display_name ? `<div class="field-error-msg">${escapeHtml(this.editErrors.display_name)}</div>` : ''}
                                </div>

                                <div class="form-group">
                                    <label class="form-label" for="edit-username">Username</label>
                                    <input 
                                        type="text" 
                                        class="form-input ${this.editErrors.username ? 'input-error' : ''}" 
                                        id="edit-username" 
                                        name="username" 
                                        value="${escapeHtml(p.username)}" 
                                        maxlength="30"
                                        required
                                    >
                                    ${this.editErrors.username ? `<div class="field-error-msg">${escapeHtml(this.editErrors.username)}</div>` : ''}
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
                                    >${escapeHtml(p.bio || '')}</textarea>
                                    ${this.editErrors.bio ? `<div class="field-error-msg">${escapeHtml(this.editErrors.bio)}</div>` : ''}
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
        `;

        this.bindProfileCardEvents();
    }

    renderPostsSection() {
        const mount = this.container.querySelector('#profile-posts-mount');
        if (!mount || !this.profile) return;

        const isOwn = Boolean(this.profile.is_own_profile);

        mount.innerHTML = `
            ${isOwn ? `<div id="composer-mount"></div>` : ''}
            <div id="timeline-stream-mount" class="timeline-stream"></div>
        `;

        if (isOwn) {
            this.renderComposer();
        }
        this.renderTimelineStream();
    }

    renderComposer() {
        const mount = this.container.querySelector('#composer-mount');
        if (!mount || !this.profile || !this.profile.is_own_profile) return;

        const p = this.profile;
        const initials = (p.display_name || p.username || 'F')
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);

        const currentLen = (this.composerText || '').length;
        const isNearLimit = currentLen >= 1900 && currentLen <= 2000;
        const isExceeded = currentLen > 2000;

        mount.innerHTML = `
            <div class="composer-card" id="post-composer">
                <div class="composer-header">
                    <div class="composer-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
                    <span class="composer-prompt-text">Share a thought or update with your followers</span>
                </div>
                <form id="post-composer-form">
                    <textarea 
                        id="composer-input"
                        class="composer-textarea"
                        placeholder="What's happening? (up to 2,000 characters)"
                        maxlength="2100"
                        rows="3"
                        aria-label="Write your post content"
                    >${escapeHtml(this.composerText)}</textarea>

                    ${this.composerError ? `
                        <div class="composer-error" id="composer-error-msg" role="alert">
                            ${escapeHtml(this.composerError)}
                        </div>
                    ` : ''}

                    <div class="composer-footer">
                        <span 
                            class="composer-char-count ${isExceeded ? 'char-exceeded' : (isNearLimit ? 'char-warning' : '')}" 
                            id="composer-char-count"
                        >
                            ${currentLen} / 2,000
                        </span>
                        <button 
                            type="submit" 
                            class="btn-publish" 
                            id="btn-publish-post"
                            ${this.isPublishing || currentLen === 0 || isExceeded ? 'disabled' : ''}
                        >
                            ${this.isPublishing 
                                ? '<span class="btn-spinner" style="width: 14px; height: 14px; border-top-color: white;"></span> Publishing...' 
                                : 'Publish Post'}
                        </button>
                    </div>
                </form>
            </div>
        `;

        this.bindComposerEvents();
    }

    renderTimelineStream() {
        const mount = this.container.querySelector('#timeline-stream-mount');
        if (!mount) return;

        // 1. Loading Skeletons
        if (this.postsLoading) {
            mount.innerHTML = `
                <div class="post-skeleton">
                    <div class="skeleton-header">
                        <div class="skeleton-avatar skeleton-shimmer"></div>
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <div class="skeleton-text-line skeleton-shimmer"></div>
                            <div class="skeleton-text-line skeleton-shimmer" style="width: 80px; height: 10px;"></div>
                        </div>
                    </div>
                    <div class="skeleton-body-line skeleton-shimmer"></div>
                    <div class="skeleton-body-line-short skeleton-shimmer"></div>
                </div>
                <div class="post-skeleton">
                    <div class="skeleton-header">
                        <div class="skeleton-avatar skeleton-shimmer"></div>
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <div class="skeleton-text-line skeleton-shimmer"></div>
                            <div class="skeleton-text-line skeleton-shimmer" style="width: 80px; height: 10px;"></div>
                        </div>
                    </div>
                    <div class="skeleton-body-line skeleton-shimmer"></div>
                </div>
            `;
            return;
        }

        // 2. Private Profile Restriction
        if (this.postsRestricted) {
            mount.innerHTML = `
                <div class="profile-empty-state">
                    <div class="empty-icon-circle">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </div>
                    <h3 class="font-bold text-base" style="color: var(--color-midnight-navy);">This Account is Private</h3>
                    <p class="text-sm text-muted" style="max-width: 340px;">
                        Follow @${escapeHtml(this.profile.username)} to see their posts and social timeline.
                    </p>
                </div>
            `;
            return;
        }

        // 3. Loading Error
        if (this.postsError) {
            mount.innerHTML = `
                <div class="profile-empty-state">
                    <div class="empty-icon-circle" style="color: var(--color-danger);">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    </div>
                    <h3 class="font-bold text-base" style="color: var(--color-midnight-navy);">Unable to load posts</h3>
                    <p class="text-sm text-muted" style="max-width: 320px;">${escapeHtml(this.postsError)}</p>
                    <button type="button" class="profile-action-btn profile-action-btn-secondary" id="btn-retry-posts" style="margin-top: var(--space-2);">
                        Try Again
                    </button>
                </div>
            `;
            const retryBtn = mount.querySelector('#btn-retry-posts');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => this.loadPosts({ page: 1 }));
            }
            return;
        }

        // 4. Empty State
        if (this.posts.length === 0) {
            mount.innerHTML = `
                <div class="profile-empty-state" id="posts-empty-state">
                    <div class="empty-icon-circle">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    </div>
                    <h3 class="font-bold text-base" style="color: var(--color-midnight-navy);">No posts yet</h3>
                    <p class="text-sm text-muted" style="max-width: 340px;">
                        ${this.profile.is_own_profile 
                            ? 'You haven\'t posted anything yet. Share your first thought above!' 
                            : `When @${escapeHtml(this.profile.username)} posts, their updates will appear here.`}
                    </p>
                </div>
            `;
            return;
        }

        // 5. Posts Stream List
        let html = '';
        for (const post of this.posts) {
            const author = post.author || {
                username: this.profile.username,
                display_name: this.profile.display_name
            };
            const initials = (author.display_name || author.username || 'F')
                .split(' ')
                .map(n => n[0])
                .join('')
                .toUpperCase()
                .substring(0, 2);

            const isOwn = Boolean(post.is_own_post || this.profile.is_own_profile);
            const isEditing = this.editingPostId === post.id;
            const isDeleting = this.deleteConfirmPostId === post.id;
            const isEdited = new Date(post.updated_at).getTime() - new Date(post.created_at).getTime() > 2000;

            if (isEditing) {
                // Post in Edit Mode
                const editLen = (this.editingText || '').length;
                const isOver = editLen > 2000;
                html += `
                    <div class="post-card" id="post-${post.id}">
                        <div class="post-header">
                            <div class="post-author-link">
                                <div class="post-author-avatar">${escapeHtml(initials)}</div>
                                <div class="post-author-meta">
                                    <span class="post-author-display">Editing Post</span>
                                    <span class="post-author-handle">@${escapeHtml(author.username)}</span>
                                </div>
                            </div>
                        </div>

                        <form class="post-edit-container post-edit-form" data-post-id="${post.id}">
                            <textarea 
                                class="edit-textarea" 
                                rows="3" 
                                maxlength="2100"
                                aria-label="Edit post content"
                            >${escapeHtml(this.editingText)}</textarea>

                            ${this.editPostError ? `
                                <div class="composer-error" role="alert">${escapeHtml(this.editPostError)}</div>
                            ` : ''}

                            <div class="edit-actions-row">
                                <span class="composer-char-count ${isOver ? 'char-exceeded' : ''}">
                                    ${editLen} / 2,000
                                </span>
                                <div class="edit-btn-group">
                                    <button type="button" class="post-action-btn btn-cancel-edit-post" data-post-id="${post.id}">
                                        Cancel
                                    </button>
                                    <button 
                                        type="submit" 
                                        class="btn-publish btn-save-edit-post" 
                                        style="padding: 6px 16px; font-size: var(--font-size-xs);"
                                        ${this.isSavingEdit || editLen === 0 || isOver ? 'disabled' : ''}
                                    >
                                        ${this.isSavingEdit 
                                            ? '<span class="btn-spinner" style="width: 12px; height: 12px; border-top-color: white;"></span> Saving...' 
                                            : 'Save'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                `;
            } else {
                // Normal Post Card
                html += `
                    <article class="post-card" id="post-${post.id}" data-post-id="${post.id}">
                        <div class="post-header">
                            <a href="#profile/${encodeURIComponent(author.username)}" class="post-author-link">
                                <div class="post-author-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
                                <div class="post-author-meta">
                                    <div class="post-author-name-row">
                                        <span class="post-author-display">${escapeHtml(author.display_name || author.username)}</span>
                                        <span class="post-author-handle">@${escapeHtml(author.username)}</span>
                                    </div>
                                    <div class="post-time-meta">
                                        <time datetime="${post.created_at}" title="${formatFullDate(post.created_at)}">
                                            ${formatRelativeTime(post.created_at)}
                                        </time>
                                        ${isEdited ? `<span class="post-edited-indicator" title="Edited on ${formatFullDate(post.updated_at)}">· (edited)</span>` : ''}
                                    </div>
                                </div>
                            </a>

                            ${isOwn ? `
                                <div class="post-actions-group">
                                    <button 
                                        type="button" 
                                        class="post-action-btn btn-edit-post" 
                                        data-post-id="${post.id}"
                                        title="Edit post"
                                        aria-label="Edit post"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                        <span>Edit</span>
                                    </button>
                                    <button 
                                        type="button" 
                                        class="post-action-btn post-action-btn-danger btn-delete-post" 
                                        data-post-id="${post.id}"
                                        title="Delete post"
                                        aria-label="Delete post"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                        <span>Delete</span>
                                    </button>
                                </div>
                            ` : ''}
                        </div>

                        <!-- Post Body Content (Strict textContent DOM injection for XSS safety) -->
                        <div class="post-body">
                            <p class="post-content-text" data-post-body="${post.id}"></p>
                        </div>

                        <!-- Inline Delete Confirmation Prompt -->
                        ${isDeleting ? `
                            <div class="delete-confirm-box" id="delete-box-${post.id}" role="alert">
                                <span class="delete-confirm-text">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                    Delete this post? This cannot be undone.
                                </span>
                                <div class="delete-btn-group">
                                    <button type="button" class="post-action-btn btn-cancel-delete" data-post-id="${post.id}">
                                        Cancel
                                    </button>
                                    <button 
                                        type="button" 
                                        class="btn-delete-confirm btn-confirm-delete" 
                                        data-post-id="${post.id}"
                                        ${this.isDeleting ? 'disabled' : ''}
                                    >
                                        ${this.isDeleting ? 'Deleting...' : 'Delete Post'}
                                    </button>
                                </div>
                            </div>
                        ` : ''}
                    </article>
                `;
            }
        }

        // Pagination Controls
        if (this.pagination && this.pagination.page < this.pagination.total_pages) {
            html += `
                <div class="pagination-container">
                    <button 
                        type="button" 
                        class="btn-load-more" 
                        id="btn-load-more" 
                        ${this.isLoadingMore ? 'disabled' : ''}
                    >
                        ${this.isLoadingMore 
                            ? '<span class="btn-spinner" style="width: 14px; height: 14px; border-top-color: currentColor;"></span> Loading...' 
                            : 'Load older posts'}
                    </button>
                    <span class="text-xs text-muted">Showing ${this.posts.length} of ${this.pagination.total} posts</span>
                </div>
            `;
        }

        mount.innerHTML = html;

        // XSS Defense: Populate all post content strictly using textContent
        mount.querySelectorAll('[data-post-body]').forEach(el => {
            const id = el.getAttribute('data-post-body');
            const post = this.posts.find(p => p.id === id);
            if (post) {
                el.textContent = post.content;
            }
        });

        this.bindTimelineEvents();
    }

    // =========================================================================
    // Event Binding Handlers
    // =========================================================================

    bindProfileCardEvents() {
        const editBtn = this.container.querySelector('#btn-edit-profile');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                this.isEditing = !this.isEditing;
                this.serverAlert = null;
                this.editErrors = {};
                this.renderProfileCard();
            });
        }

        const cancelEditBtn = this.container.querySelector('#btn-cancel-edit');
        if (cancelEditBtn) {
            cancelEditBtn.addEventListener('click', () => {
                this.isEditing = false;
                this.editErrors = {};
                this.serverAlert = null;
                this.renderProfileCard();
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

    bindComposerEvents() {
        const composerForm = this.container.querySelector('#post-composer-form');
        if (!composerForm) return;

        const textarea = composerForm.querySelector('#composer-input');
        const charCount = composerForm.querySelector('#composer-char-count');
        const publishBtn = composerForm.querySelector('#btn-publish-post');

        if (textarea && charCount && publishBtn) {
            textarea.addEventListener('input', () => {
                const len = textarea.value.length;
                this.composerText = textarea.value;
                charCount.textContent = `${len} / 2,000`;

                charCount.className = 'composer-char-count' + 
                    (len > 2000 ? ' char-exceeded' : (len >= 1900 ? ' char-warning' : ''));

                const hasContent = textarea.value.trim().length > 0;
                publishBtn.disabled = !hasContent || len > 2000 || this.isPublishing;
            });
        }

        composerForm.addEventListener('submit', (e) => this.handleCreatePost(e));
    }

    bindTimelineEvents() {
        const mount = this.container.querySelector('#timeline-stream-mount');
        if (!mount) return;

        // Edit Post Button -> Toggle Edit Mode
        mount.querySelectorAll('.btn-edit-post').forEach(btn => {
            btn.addEventListener('click', () => {
                const postId = btn.getAttribute('data-post-id');
                const post = this.posts.find(p => p.id === postId);
                if (post) {
                    this.editingPostId = postId;
                    this.editingText = post.content;
                    this.editPostError = null;
                    this.deleteConfirmPostId = null;
                    this.renderTimelineStream();
                }
            });
        });

        // Cancel Edit Button
        mount.querySelectorAll('.btn-cancel-edit-post').forEach(btn => {
            btn.addEventListener('click', () => {
                this.editingPostId = null;
                this.editingText = '';
                this.editPostError = null;
                this.renderTimelineStream();
            });
        });

        // Submit Edited Post
        mount.querySelectorAll('.post-edit-form').forEach(form => {
            const postId = form.getAttribute('data-post-id');
            const textarea = form.querySelector('.edit-textarea');
            const countEl = form.querySelector('.composer-char-count');
            const saveBtn = form.querySelector('.btn-save-edit-post');

            if (textarea && countEl && saveBtn) {
                textarea.addEventListener('input', () => {
                    const len = textarea.value.length;
                    this.editingText = textarea.value;
                    countEl.textContent = `${len} / 2,000`;
                    countEl.className = 'composer-char-count' + (len > 2000 ? ' char-exceeded' : '');
                    saveBtn.disabled = len === 0 || len > 2000 || this.isSavingEdit;
                });
            }

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const content = textarea ? textarea.value : '';
                this.handleSaveEdit(postId, content);
            });
        });

        // Prompt Delete Button -> Show Inline Confirmation
        mount.querySelectorAll('.btn-delete-post').forEach(btn => {
            btn.addEventListener('click', () => {
                const postId = btn.getAttribute('data-post-id');
                this.deleteConfirmPostId = postId;
                this.editingPostId = null;
                this.renderTimelineStream();
            });
        });

        // Cancel Delete Button
        mount.querySelectorAll('.btn-cancel-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                this.deleteConfirmPostId = null;
                this.renderTimelineStream();
            });
        });

        // Confirm Delete Button -> Execute Delete
        mount.querySelectorAll('.btn-confirm-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const postId = btn.getAttribute('data-post-id');
                this.handleConfirmDelete(postId);
            });
        });

        // Pagination: Load More Button
        const loadMoreBtn = mount.querySelector('#btn-load-more');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                if (this.pagination && this.pagination.page < this.pagination.total_pages) {
                    this.loadPosts({ page: this.pagination.page + 1, append: true });
                }
            });
        }
    }
}
