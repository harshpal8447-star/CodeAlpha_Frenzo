/**
 * Diagnostics Component
 * Renders backend connection health, latency, uptime, and error states.
 */
import { checkBackendHealth } from '../api/healthApi.js';
import { API_CONFIG } from '../api/config.js';

export class DiagnosticsComponent {
    constructor(containerElement) {
        this.container = containerElement;
        this.state = {
            status: 'loading', // 'loading' | 'connected' | 'error'
            data: null,
            error: null,
            lastChecked: null
        };
    }

    async init() {
        this.render();
        await this.refresh();
    }

    async refresh() {
        this.state.status = 'loading';
        this.state.error = null;
        this.render();

        try {
            const health = await checkBackendHealth();
            this.state.status = 'connected';
            this.state.data = health;
            this.state.lastChecked = new Date().toLocaleTimeString();
        } catch (err) {
            this.state.status = 'error';
            this.state.error = err.message || 'Connection failed';
            this.state.lastChecked = new Date().toLocaleTimeString();
        }

        this.render();
    }

    render() {
        if (!this.container) return;

        let statusPillHtml = '';
        let detailsHtml = '';

        if (this.state.status === 'loading') {
            statusPillHtml = `
                <span class="diagnostics-status-pill status-loading">
                    <span class="status-indicator-dot"></span>
                    Testing Connection...
                </span>
            `;
            detailsHtml = `
                <div class="text-sm text-muted">Contacting <code>${API_CONFIG.BASE_URL}/health</code>...</div>
            `;
        } else if (this.state.status === 'connected') {
            const { version, uptime, latencyMs } = this.state.data;
            statusPillHtml = `
                <span class="diagnostics-status-pill status-connected">
                    <span class="status-indicator-dot"></span>
                    Backend Online (v${version})
                </span>
            `;
            detailsHtml = `
                <div class="diagnostics-row">
                    <span class="text-muted text-sm">Response Latency:</span>
                    <span class="font-semibold text-sm" style="color: var(--color-success);">${latencyMs} ms</span>
                </div>
                <div class="diagnostics-row">
                    <span class="text-muted text-sm">Server Uptime:</span>
                    <span class="font-medium text-sm">${uptime}s</span>
                </div>
                <div class="diagnostics-row">
                    <span class="text-muted text-sm">Target Endpoint:</span>
                    <span class="text-xs" style="color: var(--color-primary-violet);"><code>${API_CONFIG.BASE_URL}/health</code></span>
                </div>
            `;
        } else {
            statusPillHtml = `
                <span class="diagnostics-status-pill status-disconnected">
                    <span class="status-indicator-dot"></span>
                    Backend Offline
                </span>
            `;
            detailsHtml = `
                <div class="text-sm" style="color: var(--color-danger);">${this.state.error}</div>
                <div class="text-xs text-muted" style="margin-top: 4px;">
                    Ensure the Express backend is running on <code>http://localhost:5000</code>.
                </div>
            `;
        }

        this.container.innerHTML = `
            <div class="card-foundation">
                <div class="foundation-header">
                    <div>
                        <div class="foundation-badge">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                            Phase 1 Diagnostic
                        </div>
                        <h3 style="margin-top: 8px;">System Foundation Status</h3>
                        <p class="text-sm text-muted" style="margin-top: 2px;">Real-time communication bridge with the Express REST API</p>
                    </div>
                    <div>${statusPillHtml}</div>
                </div>

                <div class="diagnostics-panel">
                    ${detailsHtml}
                </div>

                <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                    <span class="text-xs text-subtle">
                        ${this.state.lastChecked ? `Checked at ${this.state.lastChecked}` : 'Initializing...'}
                    </span>
                    <button id="btn-recheck-health" class="btn-retry">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                        Re-check
                    </button>
                </div>
            </div>
        `;

        const retryBtn = this.container.querySelector('#btn-recheck-health');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => this.refresh());
        }
    }
}
