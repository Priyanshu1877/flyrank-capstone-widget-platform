/**
 * FlyRank Dashboard & Lead Management Client Application
 * Phase 3B — Frontend UI
 */
(function () {
  'use strict';

  // State Management
  const state = {
    token: localStorage.getItem('flyrank_token') || '',
    user: JSON.parse(localStorage.getItem('flyrank_user') || 'null'),
    tenant: JSON.parse(localStorage.getItem('flyrank_tenant') || 'null'),
    widgets: [],
    page: 1,
    limit: 20,
    sort: 'created_at_desc',
    widgetId: '',
    from: '',
    to: '',
    isLoadingSubmissions: false,
    isLoadingStats: false,
    activeDetailId: null,
  };

  // Base API configuration
  const API_BASE = window.location.origin;

  /**
   * Centralized API Client with Bearer Authentication
   */
  async function apiRequest(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });

      if (response.status === 401) {
        handleAuthFailure();
        throw new Error('Authentication session expired. Please log in.');
      }

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMsg = body?.error?.message || body?.message || `HTTP error ${response.status}`;
        const err = new Error(errorMsg);
        err.status = response.status;
        err.data = body;
        throw err;
      }

      return body;
    } catch (err) {
      if (err.name === 'TypeError') {
        throw new Error('Unable to connect to FlyRank API. Please check your connection.', {
          cause: err,
        });
      }
      throw err;
    }
  }

  /**
   * Safe text DOM helper: guarantees zero HTML execution (Anti-XSS)
   */
  function createSafeTextElement(tag, text, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text === null || text === undefined ? '' : String(text);
    return el;
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  }

  /**
   * Authentication State Handling
   */
  function handleAuthFailure() {
    state.token = '';
    state.user = null;
    state.tenant = null;
    localStorage.removeItem('flyrank_token');
    localStorage.removeItem('flyrank_user');
    localStorage.removeItem('flyrank_tenant');
    updateHeaderUserBadge();
    showAuthModal(true);
  }

  function setAuthenticatedSession(token, user, tenant) {
    state.token = token;
    state.user = user;
    state.tenant = tenant;
    localStorage.setItem('flyrank_token', token);
    localStorage.setItem('flyrank_user', JSON.stringify(user));
    localStorage.setItem('flyrank_tenant', JSON.stringify(tenant));
    updateHeaderUserBadge();
    showAuthModal(false);
    loadAllDashboardData();
  }

  function updateHeaderUserBadge() {
    const badge = document.getElementById('userBadgeContainer');
    const loginBtn = document.getElementById('headerLoginBtn');
    const logoutBtn = document.getElementById('headerLogoutBtn');

    if (state.token && state.user) {
      badge.style.display = 'flex';
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-flex';

      const tenantNameEl = document.getElementById('headerTenantName');
      const userEmailEl = document.getElementById('headerUserEmail');
      tenantNameEl.textContent = state.tenant?.name || 'My Tenant';
      userEmailEl.textContent = state.user?.email || '';
    } else {
      badge.style.display = 'none';
      loginBtn.style.display = 'inline-flex';
      logoutBtn.style.display = 'none';
    }
  }

  function showAuthModal(show) {
    const modal = document.getElementById('authModal');
    if (show) {
      modal.classList.add('open');
      document.getElementById('authErrorBanner').style.display = 'none';
    } else {
      modal.classList.remove('open');
    }
  }

  /**
   * Stats Loading
   */
  async function loadStats() {
    state.isLoadingStats = true;

    try {
      let url = '/api/v1/dashboard/submissions/stats';
      if (state.widgetId) {
        url += `?widgetId=${encodeURIComponent(state.widgetId)}`;
      }

      const res = await apiRequest(url);
      const data = res.data;

      document.getElementById('statTotal').textContent = (
        data.totalSubmissions || 0
      ).toLocaleString();
      document.getElementById('statToday').textContent = (data.today || 0).toLocaleString();
      document.getElementById('statWeek').textContent = (data.thisWeek || 0).toLocaleString();
      document.getElementById('statMonth').textContent = (data.thisMonth || 0).toLocaleString();
    } catch (err) {
      console.error('Failed to load stats:', err.message);
    } finally {
      state.isLoadingStats = false;
    }
  }

  /**
   * Submissions Table Loading
   */
  async function loadSubmissions() {
    const tbody = document.getElementById('submissionsTbody');
    const emptyState = document.getElementById('submissionsEmptyState');
    const errorState = document.getElementById('submissionsErrorState');
    state.isLoadingSubmissions = true;

    // Show skeleton rows
    tbody.innerHTML = '';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';

    for (let i = 0; i < 5; i++) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.innerHTML = '<div class="skeleton-row"></div>';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    try {
      const params = new URLSearchParams({
        page: String(state.page),
        limit: String(state.limit),
        sort: state.sort,
      });

      if (state.widgetId) params.append('widgetId', state.widgetId);
      if (state.from) params.append('from', state.from);
      if (state.to) params.append('to', state.to);

      const res = await apiRequest(`/api/v1/dashboard/submissions?${params.toString()}`);
      const submissions = res.data || [];
      const pagination = res.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 };

      tbody.innerHTML = '';

      if (submissions.length === 0) {
        emptyState.style.display = 'block';
        updatePaginationUI(pagination);
        return;
      }

      submissions.forEach((sub) => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-id', sub.id);
        tr.onclick = () => openSubmissionDetail(sub.id);

        // 1. ID Column
        const tdId = document.createElement('td');
        const code = createSafeTextElement(
          'code',
          sub.id.substring(0, 8) + '...',
          'code-snippet-box',
        );
        code.title = sub.id;
        tdId.appendChild(code);

        // 2. Widget Column
        const tdWidget = document.createElement('td');
        const widgetName = createSafeTextElement(
          'strong',
          sub.widgetName || 'Widget',
          'widget-name-label',
        );
        tdWidget.appendChild(widgetName);

        // 3. Submitted Data Summary (Safe rendering!)
        const tdData = document.createElement('td');
        const preview = summarizePayload(sub.payload);
        const previewEl = createSafeTextElement('span', preview, 'sub-preview-text');
        tdData.appendChild(previewEl);

        // 4. Location / Geo Column
        const tdGeo = document.createElement('td');
        if (sub.geoCountry || sub.geoCity) {
          const locParts = [sub.geoCity, sub.geoCountry].filter(Boolean).join(', ');
          const badge = createSafeTextElement('span', locParts, 'badge badge-info');
          tdGeo.appendChild(badge);
        } else {
          tdGeo.appendChild(createSafeTextElement('span', 'Unknown', 'badge badge-secondary'));
        }

        // 5. Created Date Column
        const tdDate = document.createElement('td');
        tdDate.appendChild(
          createSafeTextElement('span', formatDate(sub.createdAt), 'job-time-label'),
        );

        // 6. Action Button
        const tdAction = document.createElement('td');
        const viewBtn = createSafeTextElement('button', 'View', 'btn btn-secondary btn-sm');
        viewBtn.type = 'button';
        viewBtn.onclick = (e) => {
          e.stopPropagation();
          openSubmissionDetail(sub.id);
        };
        tdAction.appendChild(viewBtn);

        tr.appendChild(tdId);
        tr.appendChild(tdWidget);
        tr.appendChild(tdData);
        tr.appendChild(tdGeo);
        tr.appendChild(tdDate);
        tr.appendChild(tdAction);

        tbody.appendChild(tr);
      });

      updatePaginationUI(pagination);
    } catch (err) {
      tbody.innerHTML = '';
      errorState.style.display = 'block';
      document.getElementById('errorMessageText').textContent = err.message;
    } finally {
      state.isLoadingSubmissions = false;
    }
  }

  function summarizePayload(payload) {
    if (!payload || typeof payload !== 'object') return 'Empty payload';
    const entries = Object.entries(payload);
    if (entries.length === 0) return 'Empty payload';

    return entries
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(' | ');
  }

  function updatePaginationUI(meta) {
    document.getElementById('pageCurrent').textContent = String(meta.page);
    document.getElementById('pageTotal').textContent = String(meta.totalPages || 1);
    document.getElementById('leadsTotalCount').textContent = String(meta.total || 0);

    const prevBtn = document.getElementById('btnPrevPage');
    const nextBtn = document.getElementById('btnNextPage');

    prevBtn.disabled = meta.page <= 1;
    nextBtn.disabled = meta.page >= meta.totalPages || meta.totalPages === 0;
  }

  /**
   * Submission Detail Modal
   */
  async function openSubmissionDetail(id) {
    const modal = document.getElementById('detailModal');
    const modalBody = document.getElementById('detailModalBody');
    const modalTitle = document.getElementById('detailModalId');
    state.activeDetailId = id;

    modalTitle.textContent = `Submission ${id.substring(0, 8)}...`;
    modalBody.innerHTML =
      '<div class="empty-state"><div class="pulse-dot" style="margin: 0 auto 10px;"></div><p>Loading submission details...</p></div>';
    modal.classList.add('open');

    try {
      const res = await apiRequest(`/api/v1/dashboard/submissions/${id}`);
      const sub = res.data;

      modalBody.innerHTML = '';

      // Metadata Grid
      const metaGrid = document.createElement('div');
      metaGrid.className = 'meta-grid';

      const fields = [
        ['Submission ID', sub.id],
        ['Widget', sub.widgetName || sub.widgetId],
        ['Origin', sub.origin || 'N/A'],
        ['Created At', formatDate(sub.createdAt)],
        ['Country', sub.geoCountry || 'None resolved'],
        ['City', sub.geoCity || 'None resolved'],
        ['Geo Provider', sub.geoProvider || 'Fallback / none'],
      ];

      fields.forEach(([k, v]) => {
        const item = document.createElement('div');
        item.className = 'meta-item';
        item.appendChild(createSafeTextElement('span', k, 'meta-key'));
        item.appendChild(createSafeTextElement('span', v, 'meta-val'));
        metaGrid.appendChild(item);
      });

      modalBody.appendChild(metaGrid);

      // Payload Container (Safe Rendering)
      const payloadTitle = createSafeTextElement('h4', 'Submitted Lead Data', 'section-title');
      payloadTitle.style.marginTop = '1rem';
      payloadTitle.style.marginBottom = '0.5rem';
      modalBody.appendChild(payloadTitle);

      const payloadCard = document.createElement('div');
      payloadCard.className = 'payload-card';

      if (sub.payload && typeof sub.payload === 'object' && Object.keys(sub.payload).length > 0) {
        Object.entries(sub.payload).forEach(([key, val]) => {
          const row = document.createElement('div');
          row.className = 'payload-row';

          row.appendChild(createSafeTextElement('div', key, 'payload-label'));
          // Render value safely as text (prevents script execution)
          row.appendChild(createSafeTextElement('div', val, 'payload-value'));
          payloadCard.appendChild(row);
        });
      } else {
        payloadCard.appendChild(
          createSafeTextElement('p', 'No form payload data submitted.', 'empty-subtext'),
        );
      }

      modalBody.appendChild(payloadCard);
    } catch (err) {
      modalBody.innerHTML = '';
      const errBox = createSafeTextElement(
        'div',
        `Error loading detail: ${err.message}`,
        'auth-banner-error',
      );
      modalBody.appendChild(errBox);
    }
  }

  function closeDetailModal() {
    document.getElementById('detailModal').classList.remove('open');
    state.activeDetailId = null;
  }

  /**
   * Operational Jobs Loading
   */
  async function loadJobs() {
    const list = document.getElementById('jobsListContainer');
    list.innerHTML = '<div class="skeleton-row"></div>';

    try {
      const res = await apiRequest('/api/v1/dashboard/jobs?page=1&limit=10');
      const jobs = res.data || [];
      list.innerHTML = '';

      if (jobs.length === 0) {
        list.innerHTML = '<p class="empty-subtext">No background jobs found.</p>';
        return;
      }

      jobs.forEach((job) => {
        const item = document.createElement('div');
        item.className = 'job-item';

        const left = document.createElement('div');
        left.className = 'job-meta-left';
        left.appendChild(createSafeTextElement('div', job.jobType, 'job-type-label'));
        left.appendChild(
          createSafeTextElement(
            'div',
            `Attempt ${job.attempts}/${job.maxAttempts} • Created ${formatDate(job.createdAt)}`,
            'job-time-label',
          ),
        );

        const badge = document.createElement('span');
        badge.className = `badge ${getJobStatusBadgeClass(job.status)}`;
        badge.textContent = job.status;

        item.appendChild(left);
        item.appendChild(badge);
        list.appendChild(item);
      });
    } catch (err) {
      list.innerHTML = '';
      const errP = document.createElement('p');
      errP.className = 'empty-subtext';
      errP.style.color = 'var(--danger)';
      errP.textContent = `Unable to load jobs: ${err.message}`;
      list.appendChild(errP);
    }
  }

  function getJobStatusBadgeClass(status) {
    switch (status) {
      case 'completed':
        return 'badge-success';
      case 'processing':
        return 'badge-info';
      case 'failed':
        return 'badge-danger';
      default:
        return 'badge-warning';
    }
  }

  /**
   * Widgets List & Embed Snippets
   */
  async function loadWidgets() {
    const widgetListEl = document.getElementById('widgetsListContainer');
    const filterSelect = document.getElementById('filterWidgetSelect');
    widgetListEl.innerHTML = '<div class="skeleton-row"></div>';

    try {
      const res = await apiRequest('/api/v1/dashboard/widgets');
      state.widgets = res.data || [];

      // Update widget filter dropdown
      filterSelect.innerHTML = '<option value="">All Widgets</option>';
      state.widgets.forEach((w) => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = w.name;
        if (state.widgetId === w.id) opt.selected = true;
        filterSelect.appendChild(opt);
      });

      widgetListEl.innerHTML = '';
      if (state.widgets.length === 0) {
        widgetListEl.innerHTML = '<p class="empty-subtext">No widgets created yet.</p>';
        return;
      }

      state.widgets.forEach((w) => {
        const item = document.createElement('div');
        item.className = 'widget-item';

        const left = document.createElement('div');
        left.className = 'widget-meta-left';

        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.alignItems = 'center';
        headerRow.style.gap = '8px';

        headerRow.appendChild(createSafeTextElement('strong', w.name, 'widget-name-label'));
        headerRow.appendChild(
          createSafeTextElement('span', `v${w.version}`, 'badge badge-secondary'),
        );

        if (w.isActive) {
          headerRow.appendChild(createSafeTextElement('span', 'Active', 'badge badge-success'));
        } else {
          headerRow.appendChild(createSafeTextElement('span', 'Inactive', 'badge badge-warning'));
        }

        left.appendChild(headerRow);

        const embedSnippet = `<script src="${API_BASE}/widget.js?id=${w.id}"></script>`;
        const snippetRow = document.createElement('div');
        snippetRow.style.display = 'flex';
        snippetRow.style.alignItems = 'center';
        snippetRow.style.gap = '8px';
        snippetRow.style.marginTop = '6px';

        const codeBox = createSafeTextElement('div', embedSnippet, 'code-snippet-box');
        codeBox.title = embedSnippet;

        const copyBtn = createSafeTextElement('button', 'Copy Snippet', 'btn btn-secondary btn-sm');
        copyBtn.type = 'button';
        copyBtn.onclick = () => copyToClipboard(embedSnippet, copyBtn);

        const demoLink = createSafeTextElement('a', 'Test Host Demo', 'btn btn-ghost btn-sm');
        demoLink.href = `http://localhost:5000/index.html?id=${w.id}`;
        demoLink.target = '_blank';
        demoLink.rel = 'noreferrer noopener';

        snippetRow.appendChild(codeBox);
        snippetRow.appendChild(copyBtn);
        snippetRow.appendChild(demoLink);

        left.appendChild(snippetRow);
        item.appendChild(left);
        widgetListEl.appendChild(item);
      });
    } catch (err) {
      widgetListEl.innerHTML = '';
      const errP = document.createElement('p');
      errP.className = 'empty-subtext';
      errP.style.color = 'var(--danger)';
      errP.textContent = `Unable to load widgets: ${err.message}`;
      widgetListEl.appendChild(errP);
    }
  }

  function copyToClipboard(text, btnElement) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          showCopiedFeedback(btnElement);
        })
        .catch(() => fallbackCopy(text, btnElement));
    } else {
      fallbackCopy(text, btnElement);
    }
  }

  function fallbackCopy(text, btnElement) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showCopiedFeedback(btnElement);
  }

  function showCopiedFeedback(btn) {
    const originalText = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.style.color = 'var(--success)';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.color = '';
    }, 2000);
  }

  /**
   * Master Dashboard Refresh
   */
  function loadAllDashboardData() {
    if (!state.token) {
      showAuthModal(true);
      return;
    }
    loadStats();
    loadSubmissions();
    loadJobs();
    loadWidgets();
  }

  /**
   * Setup Event Listeners
   */
  function setupEvents() {
    // Refresh button
    document.getElementById('btnRefreshData')?.addEventListener('click', () => {
      loadAllDashboardData();
    });

    // Logout
    document.getElementById('headerLogoutBtn')?.addEventListener('click', () => {
      handleAuthFailure();
    });

    // Login from header
    document.getElementById('headerLoginBtn')?.addEventListener('click', () => {
      showAuthModal(true);
    });

    // Auth Modal Tabs
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const formLogin = document.getElementById('loginForm');
    const formRegister = document.getElementById('registerForm');

    tabLogin?.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      formLogin.style.display = 'block';
      formRegister.style.display = 'none';
    });

    tabRegister?.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      formRegister.style.display = 'block';
      formLogin.style.display = 'none';
    });

    // Demo Account Helper
    document.getElementById('btnFillDemoAccount')?.addEventListener('click', () => {
      document.getElementById('loginEmail').value = 'demo@flyrank.test';
      document.getElementById('loginPassword').value = 'Password123!';
    });

    // Login Form Submit
    formLogin?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const errBox = document.getElementById('authErrorBanner');
      errBox.style.display = 'none';

      try {
        const res = await apiRequest('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setAuthenticatedSession(res.data.token, res.data.user, res.data.tenant);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });

    // Register Form Submit
    formRegister?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('registerName').value.trim();
      const email = document.getElementById('registerEmail').value.trim();
      const password = document.getElementById('registerPassword').value;
      const errBox = document.getElementById('authErrorBanner');
      errBox.style.display = 'none';

      try {
        const res = await apiRequest('/api/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name, email, password }),
        });
        setAuthenticatedSession(res.data.token, res.data.user, res.data.tenant);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });

    // Widget Filter Select
    document.getElementById('filterWidgetSelect')?.addEventListener('change', (e) => {
      state.widgetId = e.target.value;
      state.page = 1;
      loadStats();
      loadSubmissions();
    });

    // Sort Select
    document.getElementById('filterSortSelect')?.addEventListener('change', (e) => {
      state.sort = e.target.value;
      state.page = 1;
      loadSubmissions();
    });

    // Limit Select
    document.getElementById('filterLimitSelect')?.addEventListener('change', (e) => {
      state.limit = Number(e.target.value) || 20;
      state.page = 1;
      loadSubmissions();
    });

    // Date Filters Apply
    document.getElementById('btnApplyDateFilter')?.addEventListener('click', () => {
      const fromVal = document.getElementById('filterFromDate').value;
      const toVal = document.getElementById('filterToDate').value;

      state.from = fromVal ? new Date(fromVal).toISOString() : '';
      state.to = toVal ? new Date(toVal).toISOString() : '';
      state.page = 1;
      loadSubmissions();
    });

    // Date Filters Clear
    document.getElementById('btnClearDateFilter')?.addEventListener('click', () => {
      document.getElementById('filterFromDate').value = '';
      document.getElementById('filterToDate').value = '';
      state.from = '';
      state.to = '';
      state.page = 1;
      loadSubmissions();
    });

    // Quick Date Preset Buttons
    document.querySelectorAll('.btn-date-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const days = Number(btn.getAttribute('data-days')) || 0;
        const now = new Date();
        const start = new Date(Date.now() - days * 86400000);

        document.getElementById('filterFromDate').value = start.toISOString().split('T')[0];
        document.getElementById('filterToDate').value = now.toISOString().split('T')[0];
        state.from = start.toISOString();
        state.to = now.toISOString();
        state.page = 1;
        loadSubmissions();
      });
    });

    // Pagination Buttons
    document.getElementById('btnPrevPage')?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page--;
        loadSubmissions();
      }
    });

    document.getElementById('btnNextPage')?.addEventListener('click', () => {
      state.page++;
      loadSubmissions();
    });

    // Modal Close
    document.getElementById('btnCloseDetailModal')?.addEventListener('click', closeDetailModal);
    document.getElementById('detailModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'detailModal') closeDetailModal();
    });

    // Keyboard support: Escape closes modal
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDetailModal();
      }
    });

    // Retry Button
    document.getElementById('btnRetrySubmissions')?.addEventListener('click', () => {
      loadSubmissions();
    });
  }

  // Initialize Application
  function init() {
    updateHeaderUserBadge();
    setupEvents();

    if (state.token) {
      loadAllDashboardData();
    } else {
      showAuthModal(true);
    }
  }

  // DOM ready trigger
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
