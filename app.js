/* ============================================
   Surgery Tracker — Application
   ============================================ */

(function () {
  'use strict';

  // ---- Configuration ----
  const API_BASE = 'https://surgery-tracker-api.21beckem8.workers.dev'; // Set to your Worker URL in production, e.g. 'https://surgery-tracker-api.yourname.workers.dev'

  // ---- Auth State ----
  function getToken() { return localStorage.getItem('surgery_tracker_token'); }
  function setToken(token) { localStorage.setItem('surgery_tracker_token', token); }
  function clearToken() { localStorage.removeItem('surgery_tracker_token'); }
  function getUserEmail() { return localStorage.getItem('surgery_tracker_email') || ''; }
  function setUserEmail(email) { localStorage.setItem('surgery_tracker_email', email); }

  // ---- API Helpers ----
  async function api(path, options = {}) {
    const url = API_BASE + path;
    const headers = { ...(options.headers || {}) };
    const token = getToken();
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const resp = await fetch(url, { ...options, headers });
    if (resp.status === 401) {
      clearToken();
      state.authScreen = 'login';
      state.currentModal = null;
      render();
      throw new Error('Session expired. Please log in again.');
    }
    return resp;
  }

  async function apiJson(path, options = {}) {
    const resp = await api(path, options);
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || 'Request failed.');
    }
    return data;
  }

  // ---- Application State ----
  const state = {
    // Auth
    authScreen: getToken() ? null : 'login', // null = logged in, 'login', 'register'
    authLoading: false,
    authError: '',

    // Share view (doctor)
    shareMode: false,
    shareCode: null,
    shareVerified: false,
    shareLoading: false,
    shareError: '',
    shareData: null, // { patient_info, surgeries, documents, user_id }

    // Main data
    surgeries: [],
    patientInfo: { name: '', dob: '', blood_type: '', allergies: '' },
    dataLoaded: false,
    dataLoading: false,

    // UI
    searchQuery: '',
    sortBy: 'date-desc',
    currentModal: null, // null | 'add' | 'edit' | 'delete' | 'share' | 'settings' | 'detail'
    editingId: null,
    deletingId: null,
    viewingId: null,

    // Share links
    shareLinks: [],
    shareLinksLoaded: false,

    // Documents
    documentsCache: {}, // surgeryId -> [docs]
    uploadingDoc: false,
  };

  // ---- Check for share mode ----
  function checkShareMode() {
    const path = window.location.pathname;
    const hashPath = window.location.hash;

    // Support /share/CODE or #/share/CODE
    let code = null;
    const pathMatch = path.match(/\/share\/([A-Za-z0-9]+)/);
    const hashMatch = hashPath.match(/#\/share\/([A-Za-z0-9]+)/);

    if (pathMatch) code = pathMatch[1];
    else if (hashMatch) code = hashMatch[1];

    console.log('Checking share mode with code:', code);
    

    if (code) {
      state.shareMode = true;
      state.shareCode = code;
      state.authScreen = null;
      return true;
    }
    return false;
  }

  checkShareMode();

  // ---- Render Engine ----
  const app = document.getElementById('app');

  function render() {
    if (state.shareMode) {
      if (state.shareVerified) {
        app.innerHTML = renderShareView();
      } else {
        app.innerHTML = renderDobVerification();
      }
    } else if (state.authScreen) {
      app.innerHTML = renderAuthScreen();
    } else if (!state.dataLoaded) {
      app.innerHTML = renderLoadingScreen();
      if (!state.dataLoading) loadData();
    } else {
      app.innerHTML = renderMainView();
    }
    bindEvents();
  }

  // ---- Loading Screen ----
  function renderLoadingScreen() {
    return `
      <div class="loading-screen">
        <div class="loading-spinner"></div>
        <div>Loading your data...</div>
      </div>
    `;
  }

  // ---- Auth Screen ----
  function renderAuthScreen() {
    const isLogin = state.authScreen === 'login';
    return `
      <div class="auth-wrapper">
        <div class="auth-card">
          <div class="auth-header">
            <div class="auth-icon"><i class="fa-solid fa-hospital"></i></div>
            <h1>${isLogin ? 'Welcome Back' : 'Create Account'}</h1>
            <p>${isLogin ? 'Sign in to your Surgery Tracker' : 'Start tracking your surgical history'}</p>
          </div>
          <div class="auth-body">
            <div class="auth-error ${state.authError ? 'visible' : ''}" id="authError">
              <i class="fa-solid fa-circle-exclamation"></i>
              <span>${escHtml(state.authError)}</span>
            </div>
            <form id="authForm" onsubmit="window._app.submitAuth(event)">
              <div class="form-group">
                <label class="form-label">Email Address</label>
                <input class="form-input" type="email" name="email" required placeholder="you@example.com" autocomplete="email">
              </div>
              <div class="form-group">
                <label class="form-label">Password</label>
                <input class="form-input" type="password" name="password" required placeholder="${isLogin ? 'Your password' : 'At least 8 characters'}" minlength="${isLogin ? 1 : 8}" autocomplete="${isLogin ? 'current-password' : 'new-password'}">
              </div>
              ${!isLogin ? `
              <div class="form-group">
                <label class="form-label">Confirm Password</label>
                <input class="form-input" type="password" name="confirmPassword" required placeholder="Re-enter your password" minlength="8" autocomplete="new-password">
              </div>
              ` : ''}
              <button type="submit" class="btn btn-blue btn-full" ${state.authLoading ? 'disabled' : ''}>
                ${state.authLoading ? '<span class="loading-spinner white"></span>' : ''}
                ${isLogin ? '<i class="fa-solid fa-right-to-bracket"></i> Sign In' : '<i class="fa-solid fa-user-plus"></i> Create Account'}
              </button>
            </form>
          </div>
          <div class="auth-footer">
            ${isLogin
              ? 'Don\'t have an account? <a onclick="window._app.switchAuth(\'register\')">Sign up</a>'
              : 'Already have an account? <a onclick="window._app.switchAuth(\'login\')">Sign in</a>'
            }
          </div>
        </div>
      </div>
    `;
  }

  // ---- DOB Verification Screen (Doctor Share) ----
  function renderDobVerification() {
    return `
      <div class="dob-verify-wrapper">
        <div class="dob-verify-card">
          <div class="dob-verify-header">
            <div class="dob-icon"><i class="fa-solid fa-user-shield"></i></div>
            <h1>Surgical History Report</h1>
            <p>To view this patient's shared records, please verify their identity by entering their date of birth.</p>
          </div>
          <div class="dob-verify-body">
            <div class="auth-error ${state.shareError ? 'visible' : ''}" id="shareError">
              <i class="fa-solid fa-circle-exclamation"></i>
              <span>${escHtml(state.shareError)}</span>
            </div>
            <form id="dobForm" onsubmit="window._app.submitDobVerify(event)">
              <div class="form-group">
                <label class="form-label">Patient's Date of Birth <span class="required">*</span></label>
                <input class="form-input" type="date" name="dob" required>
              </div>
              <button type="submit" class="btn btn-green btn-full" ${state.shareLoading ? 'disabled' : ''}>
                ${state.shareLoading ? '<span class="loading-spinner white"></span>' : '<i class="fa-solid fa-lock-open"></i>'}
                Verify &amp; View Records
              </button>
            </form>
          </div>
          <div class="dob-verify-footer">
            <i class="fa-solid fa-lock"></i> Your verification is secure. Data is shared by the patient.
          </div>
        </div>
      </div>
    `;
  }

  // ---- Main View ----
  function renderMainView() {
    const filtered = getFilteredSurgeries();
    return `
      ${renderHeader()}
      <div class="container">
        ${renderStats()}
        ${state.surgeries.length > 0 ? renderToolbar() : ''}
        ${filtered.length === 0 && state.surgeries.length === 0 ? renderEmptyState() : ''}
        ${filtered.length === 0 && state.surgeries.length > 0 ? renderNoResults() : ''}
        <div class="surgery-list">
          ${filtered.map(s => renderSurgeryCard(s, false)).join('')}
        </div>
      </div>
      ${renderModal()}
    `;
  }

  function renderHeader() {
    return `
      <header class="header">
        <div class="header-inner">
          <div>
            <h1><span class="icon"><i class="fa-solid fa-hospital"></i></span> Surgery Tracker</h1>
            <div class="header-subtitle">Personal surgical history manager</div>
          </div>
          <div class="header-actions">
            <span class="header-user"><i class="fa-solid fa-user"></i> ${escHtml(getUserEmail())}</span>
            <button class="btn btn-outline btn-sm" onclick="window._app.openSettings()"><i class="fa-solid fa-gear"></i> Settings</button>
            ${state.surgeries.length > 0 ? `<button class="btn btn-outline btn-sm" onclick="window._app.openShare()"><i class="fa-solid fa-share-nodes"></i> Share</button>` : ''}
            <button class="btn btn-primary btn-sm" onclick="window._app.openAdd()"><i class="fa-solid fa-plus"></i> Add Surgery</button>
            <button class="btn btn-outline btn-sm" onclick="window._app.logout()" title="Sign out"><i class="fa-solid fa-right-from-bracket"></i></button>
          </div>
        </div>
      </header>
    `;
  }

  function renderStats() {
    if (state.surgeries.length === 0) return '';
    const total = state.surgeries.length;
    const mostRecent = state.surgeries.reduce((a, b) => new Date(a.date) > new Date(b.date) ? a : b);
    const withComplications = state.surgeries.filter(s => s.had_complications).length;
    const types = [...new Set(state.surgeries.map(s => s.category).filter(Boolean))];

    return `
      <div class="stats-bar">
        <div class="stat-card">
          <div class="stat-label">Total Surgeries</div>
          <div class="stat-value">${total}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Most Recent</div>
          <div class="stat-value" style="font-size:1.1rem">${formatDate(mostRecent.date)}</div>
          <div class="stat-sub">${escHtml(mostRecent.name)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Complications</div>
          <div class="stat-value">${withComplications}</div>
          <div class="stat-sub">out of ${total} procedures</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Categories</div>
          <div class="stat-value">${types.length}</div>
          <div class="stat-sub">${types.slice(0, 3).join(', ') || 'None set'}${types.length > 3 ? '\u2026' : ''}</div>
        </div>
      </div>
    `;
  }

  function renderToolbar() {
    return `
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="search-box">
            <i class="fa-solid fa-magnifying-glass search-icon"></i>
            <input type="text" placeholder="Search surgeries\u2026" value="${escAttr(state.searchQuery)}" oninput="window._app.setSearch(this.value)">
          </div>
        </div>
        <select class="sort-select" onchange="window._app.setSort(this.value)">
          <option value="date-desc" ${state.sortBy === 'date-desc' ? 'selected' : ''}>Newest first</option>
          <option value="date-asc" ${state.sortBy === 'date-asc' ? 'selected' : ''}>Oldest first</option>
          <option value="name-asc" ${state.sortBy === 'name-asc' ? 'selected' : ''}>Name A\u2013Z</option>
          <option value="name-desc" ${state.sortBy === 'name-desc' ? 'selected' : ''}>Name Z\u2013A</option>
        </select>
      </div>
    `;
  }

  function renderEmptyState() {
    return `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-clipboard"></i></div>
        <h2>No surgeries recorded yet</h2>
        <p>Start tracking your surgical history by adding your first surgery. You'll be able to share this information with healthcare providers.</p>
        <button class="btn btn-blue" onclick="window._app.openAdd()"><i class="fa-solid fa-plus"></i> Add Your First Surgery</button>
      </div>
    `;
  }

  function renderNoResults() {
    return `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
        <h2>No matching surgeries</h2>
        <p>Try adjusting your search query.</p>
      </div>
    `;
  }

  function renderSurgeryCard(s, isShared) {
    const tags = [];
    if (s.urgency === 'emergency') tags.push('<span class="tag tag-emergency"><i class="fa-solid fa-circle-exclamation"></i> Emergency</span>');
    if (s.urgency === 'elective') tags.push('<span class="tag tag-elective"><i class="fa-solid fa-calendar"></i> Elective</span>');
    if (s.setting === 'outpatient') tags.push('<span class="tag tag-outpatient"><i class="fa-solid fa-house"></i> Outpatient</span>');
    if (s.setting === 'inpatient') tags.push('<span class="tag tag-inpatient"><i class="fa-solid fa-bed"></i> Inpatient</span>');
    if (s.had_complications) tags.push('<span class="tag tag-complication"><i class="fa-solid fa-triangle-exclamation"></i> Complications</span>');

    // Get documents for this surgery
    const docs = isShared
      ? (state.shareData && state.shareData.documents && state.shareData.documents[s.id]) || []
      : (state.documentsCache[s.id] || []);

    return `
      <div class="surgery-card" data-id="${s.id}">
        <div class="surgery-card-header">
          <div>
            <div class="surgery-card-title">${escHtml(s.name)}</div>
            <div class="surgery-card-date"><i class="fa-solid fa-calendar"></i> ${formatDate(s.date)}${s.category ? ' \u00b7 ' + escHtml(s.category) : ''}</div>
          </div>
          ${!isShared ? `
          <div class="surgery-card-actions">
            <button class="btn btn-ghost btn-icon" onclick="window._app.openDetail('${s.id}')" title="View details"><i class="fa-solid fa-eye"></i></button>
            <button class="btn btn-ghost btn-icon" onclick="window._app.openEdit('${s.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-ghost btn-icon" onclick="window._app.openDelete('${s.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
          ` : ''}
        </div>
        <div class="surgery-card-body">
          ${s.surgeon ? `<div class="surgery-detail"><span class="surgery-detail-label">Surgeon</span><span class="surgery-detail-value">${escHtml(s.surgeon)}</span></div>` : ''}
          ${s.hospital ? `<div class="surgery-detail"><span class="surgery-detail-label">Hospital</span><span class="surgery-detail-value">${escHtml(s.hospital)}</span></div>` : ''}
          ${s.anesthesia ? `<div class="surgery-detail"><span class="surgery-detail-label">Anesthesia</span><span class="surgery-detail-value">${escHtml(s.anesthesia)}</span></div>` : ''}
          ${s.duration ? `<div class="surgery-detail"><span class="surgery-detail-label">Duration</span><span class="surgery-detail-value">${escHtml(s.duration)}</span></div>` : ''}
        </div>
        ${tags.length > 0 ? `<div class="surgery-tags">${tags.join('')}</div>` : ''}
        ${s.notes ? `
        <div class="surgery-notes">
          <div class="surgery-notes-label">Notes</div>
          <div class="surgery-notes-text">${escHtml(s.notes)}</div>
        </div>
        ` : ''}
        ${s.complications ? `
        <div class="surgery-notes">
          <div class="surgery-notes-label"><i class="fa-solid fa-triangle-exclamation" style="color:#ea580c"></i> Complications</div>
          <div class="surgery-notes-text" style="border-color:#fed7aa; background:#fff7ed;">${escHtml(s.complications)}</div>
        </div>
        ` : ''}
        ${docs.length > 0 ? renderDocumentsList(docs, s.id, isShared) : ''}
      </div>
    `;
  }

  function renderDocumentsList(docs, surgeryId, isShared) {
    return `
      <div class="documents-section">
        <div class="documents-header">
          <span class="documents-header-label"><i class="fa-solid fa-paperclip"></i> Documents (${docs.length})</span>
        </div>
        <div class="document-list">
          ${docs.map(doc => `
            <div class="document-item">
              <div class="document-item-info">
                <i class="fa-solid ${getFileIcon(doc.mime_type)}"></i>
                <span class="document-item-name">${escHtml(doc.filename)}</span>
                <span class="document-item-size">${formatFileSize(doc.size)}</span>
              </div>
              <div class="document-item-actions">
                ${isShared
                  ? `<button class="btn btn-ghost btn-sm" onclick="window._app.downloadSharedDoc('${doc.id}')" title="Download"><i class="fa-solid fa-download"></i></button>`
                  : `
                    <button class="btn btn-ghost btn-sm" onclick="window._app.downloadDoc('${doc.id}')" title="Download"><i class="fa-solid fa-download"></i></button>
                    <button class="btn btn-ghost btn-sm" onclick="window._app.deleteDoc('${doc.id}', '${surgeryId}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
                  `
                }
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ---- Share View (Doctor - verified) ----
  function renderShareView() {
    const data = state.shareData;
    const pi = data.patient_info;
    const sorted = [...data.surgeries].sort((a, b) => new Date(b.date) - new Date(a.date));

    return `
      <div class="share-banner">
        <h2><i class="fa-solid fa-hospital"></i> Surgical History Report</h2>
        <p>Shared via Surgery Tracker \u2014 read-only view</p>
      </div>
      <div class="container">
        ${pi.name ? `
        <div class="share-patient-info">
          <h3>Patient Information</h3>
          ${pi.name ? `<div class="patient-detail"><span class="patient-detail-label">Name</span><span class="patient-detail-value">${escHtml(pi.name)}</span></div>` : ''}
          ${pi.dob ? `<div class="patient-detail"><span class="patient-detail-label">Date of Birth</span><span class="patient-detail-value">${formatDate(pi.dob)}</span></div>` : ''}
          ${pi.blood_type ? `<div class="patient-detail"><span class="patient-detail-label">Blood Type</span><span class="patient-detail-value">${escHtml(pi.blood_type)}</span></div>` : ''}
          ${pi.allergies ? `<div class="patient-detail"><span class="patient-detail-label">Known Allergies</span><span class="patient-detail-value">${escHtml(pi.allergies)}</span></div>` : ''}
        </div>
        ` : ''}

        <h3 style="font-size:1rem; color:var(--gray-600); margin-bottom:16px;">${sorted.length} Surgical Procedure${sorted.length !== 1 ? 's' : ''}</h3>

        <div class="surgery-list">
          ${sorted.map(s => renderSurgeryCard(s, true)).join('')}
        </div>

        <div class="share-footer">
          <i class="fa-solid fa-hospital"></i> Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} \u00b7 Surgery Tracker
        </div>
      </div>
    `;
  }

  // ---- Modals ----
  function renderModal() {
    if (!state.currentModal) return '';
    switch (state.currentModal) {
      case 'add': return renderSurgeryForm(null);
      case 'edit': return renderSurgeryForm(state.surgeries.find(s => s.id === state.editingId));
      case 'delete': return renderDeleteConfirm();
      case 'share': return renderShareModal();
      case 'settings': return renderSettingsModal();
      case 'detail': return renderDetailModal();
      default: return '';
    }
  }

  function renderSurgeryForm(existing) {
    const s = existing || {
      name: '', date: '', surgeon: '', hospital: '', category: '',
      anesthesia: '', duration: '', urgency: 'elective', setting: 'inpatient',
      had_complications: false, complications: '', notes: '', body_region: ''
    };
    const title = existing ? 'Edit Surgery' : 'Add Surgery';
    const submitLabel = existing ? 'Save Changes' : 'Add Surgery';
    const surgeryId = existing ? existing.id : null;
    const docs = surgeryId ? (state.documentsCache[surgeryId] || []) : [];

    return `
      <div class="modal-overlay" onclick="window._app.closeModal(event)">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2><i class="fa-solid fa-${existing ? 'pen' : 'plus'}"></i> ${title}</h2>
            <button class="modal-close" onclick="window._app.closeModal()">&times;</button>
          </div>
          <form id="surgeryForm" onsubmit="window._app.submitForm(event)">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Surgery / Procedure Name <span class="required">*</span></label>
                <input class="form-input" name="name" required value="${escAttr(s.name)}" placeholder="e.g., Appendectomy, ACL Reconstruction">
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Date <span class="required">*</span></label>
                  <input class="form-input" type="date" name="date" required value="${escAttr(s.date)}">
                </div>
                <div class="form-group">
                  <label class="form-label">Category</label>
                  <select class="form-select" name="category">
                    <option value="">Select\u2026</option>
                    ${['Orthopedic', 'Cardiac', 'Neurological', 'Gastrointestinal', 'Gynecological', 'Urological', 'Ophthalmic', 'ENT', 'Dental / Oral', 'Cosmetic / Plastic', 'Oncological', 'Transplant', 'Vascular', 'Thoracic', 'Dermatological', 'Other'].map(c =>
                      `<option value="${c}" ${s.category === c ? 'selected' : ''}>${c}</option>`
                    ).join('')}
                  </select>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Surgeon</label>
                  <input class="form-input" name="surgeon" value="${escAttr(s.surgeon)}" placeholder="Dr. Smith">
                </div>
                <div class="form-group">
                  <label class="form-label">Hospital / Clinic</label>
                  <input class="form-input" name="hospital" value="${escAttr(s.hospital)}" placeholder="City General Hospital">
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Anesthesia Type</label>
                  <select class="form-select" name="anesthesia">
                    <option value="">Select\u2026</option>
                    ${['General', 'Local', 'Regional / Spinal', 'Epidural', 'Sedation / Twilight', 'None'].map(a =>
                      `<option value="${a}" ${s.anesthesia === a ? 'selected' : ''}>${a}</option>`
                    ).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Duration</label>
                  <input class="form-input" name="duration" value="${escAttr(s.duration)}" placeholder="e.g., 2 hours">
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Body Region</label>
                  <input class="form-input" name="body_region" value="${escAttr(s.body_region || '')}" placeholder="e.g., Right knee, Lower abdomen">
                </div>
                <div class="form-group">
                  <label class="form-label">Urgency & Setting</label>
                  <div class="form-checkbox-group" style="margin-top: 2px;">
                    <label class="form-checkbox">
                      <input type="radio" name="urgency" value="elective" ${s.urgency !== 'emergency' ? 'checked' : ''}> Elective
                    </label>
                    <label class="form-checkbox">
                      <input type="radio" name="urgency" value="emergency" ${s.urgency === 'emergency' ? 'checked' : ''}> Emergency
                    </label>
                  </div>
                  <div class="form-checkbox-group" style="margin-top: 8px;">
                    <label class="form-checkbox">
                      <input type="radio" name="setting" value="inpatient" ${s.setting !== 'outpatient' ? 'checked' : ''}> Inpatient
                    </label>
                    <label class="form-checkbox">
                      <input type="radio" name="setting" value="outpatient" ${s.setting === 'outpatient' ? 'checked' : ''}> Outpatient
                    </label>
                  </div>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Notes</label>
                <textarea class="form-textarea" name="notes" placeholder="Pre-op diagnosis, post-op instructions, recovery notes\u2026">${escHtml(s.notes)}</textarea>
              </div>

              <div class="form-group">
                <label class="form-checkbox" style="margin-bottom: 10px;">
                  <input type="checkbox" name="had_complications" ${s.had_complications ? 'checked' : ''} onchange="document.getElementById('complicationsGroup').style.display = this.checked ? 'block' : 'none'">
                  Had complications
                </label>
                <div id="complicationsGroup" style="display: ${s.had_complications ? 'block' : 'none'}">
                  <label class="form-label">Complication Details</label>
                  <textarea class="form-textarea" name="complications" placeholder="Describe complications\u2026">${escHtml(s.complications || '')}</textarea>
                </div>
              </div>

              ${existing ? `
              <div class="form-group">
                <label class="form-label"><i class="fa-solid fa-paperclip"></i> Documents</label>
                ${docs.length > 0 ? `
                <div class="document-list" style="margin-bottom: 10px;">
                  ${docs.map(doc => `
                    <div class="document-item">
                      <div class="document-item-info">
                        <i class="fa-solid ${getFileIcon(doc.mime_type)}"></i>
                        <span class="document-item-name">${escHtml(doc.filename)}</span>
                        <span class="document-item-size">${formatFileSize(doc.size)}</span>
                      </div>
                      <div class="document-item-actions">
                        <button type="button" class="btn btn-ghost btn-sm" onclick="window._app.downloadDoc('${doc.id}')" title="Download"><i class="fa-solid fa-download"></i></button>
                        <button type="button" class="btn btn-ghost btn-sm" onclick="window._app.deleteDoc('${doc.id}', '${surgeryId}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
                      </div>
                    </div>
                  `).join('')}
                </div>
                ` : ''}
                <div class="upload-area" onclick="document.getElementById('docUpload').click()">
                  <div><i class="fa-solid fa-cloud-arrow-up"></i></div>
                  <p>${state.uploadingDoc ? 'Uploading...' : 'Click to upload a document'}</p>
                  <div class="upload-hint">PDF, images, Word docs \u2014 max 10MB</div>
                </div>
                <input type="file" id="docUpload" style="display:none" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.txt" onchange="window._app.uploadDocument(event, '${surgeryId}')">
              </div>
              ` : ''}
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-ghost" onclick="window._app.closeModal()">Cancel</button>
              <button type="submit" class="btn btn-blue">${submitLabel}</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function renderDeleteConfirm() {
    const s = state.surgeries.find(s => s.id === state.deletingId);
    if (!s) return '';
    return `
      <div class="modal-overlay" onclick="window._app.closeModal(event)">
        <div class="modal" style="max-width:420px" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2><i class="fa-solid fa-trash"></i> Delete Surgery</h2>
            <button class="modal-close" onclick="window._app.closeModal()">&times;</button>
          </div>
          <div class="modal-body">
            <div class="confirm-body">
              <div class="confirm-icon"><i class="fa-solid fa-trash"></i></div>
              <p>Are you sure you want to delete<br><span class="confirm-name">${escHtml(s.name)}</span>?</p>
              <p style="margin-top:8px; font-size:0.82rem; color:var(--gray-400);">This action cannot be undone. All associated documents will also be deleted.</p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="window._app.closeModal()">Cancel</button>
            <button class="btn btn-danger" onclick="window._app.confirmDelete()"><i class="fa-solid fa-trash"></i> Delete</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderShareModal() {
    const shareUrl = window.location.origin + '/share/CODE';

    return `
      <div class="modal-overlay" onclick="window._app.closeModal(event)">
        <div class="modal" style="max-width:560px" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2><i class="fa-solid fa-share-nodes"></i> Share with Doctor</h2>
            <button class="modal-close" onclick="window._app.closeModal()">&times;</button>
          </div>
          <div class="modal-body">
            <p style="color:var(--gray-600); font-size:0.9rem; margin-bottom:4px;">
              Generate a secure link for your doctor. They'll need to verify your <strong>date of birth</strong> before viewing any data.
            </p>
            <p style="color:var(--gray-400); font-size:0.8rem; margin-bottom:16px;">
              <i class="fa-solid fa-circle-info"></i> The link always shows your latest data, not a snapshot. You can revoke it at any time.
            </p>

            ${!state.patientInfo.dob ? `
              <div style="background:var(--warning-light); border:1px solid #fcd34d; border-radius:var(--radius-sm); padding:12px 16px; margin-bottom:16px; font-size:0.85rem; color:#92400e;">
                <i class="fa-solid fa-lightbulb"></i> <strong>Required:</strong> Add your date of birth in <strong>Settings</strong> first. Doctors must verify your DOB to access shared data.
              </div>
            ` : `
              <button class="btn btn-blue" onclick="window._app.createShareLink()" ${state.shareLinksLoaded ? '' : 'disabled'}>
                <i class="fa-solid fa-plus"></i> Generate New Share Link
              </button>
            `}

            <div class="share-links-list">
              <h4><i class="fa-solid fa-link"></i> Your Share Links</h4>
              <div id="shareLinksContainer">
                ${state.shareLinksLoaded ? renderShareLinksList() : '<div style="text-align:center; padding:16px;"><span class="loading-spinner"></span></div>'}
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="window._app.closeModal()">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderShareLinksList() {
    if (state.shareLinks.length === 0) {
      return '<p style="color:var(--gray-400); font-size:0.85rem; text-align:center; padding:12px;">No share links created yet.</p>';
    }

    return state.shareLinks.map(link => {
      const isActive = link.active && (!link.expires_at || new Date(link.expires_at) > new Date());
      const shareUrl = window.location.origin + '/#/share/' + link.code;

      return `
        <div class="share-link-item ${!isActive ? 'revoked' : ''}">
          <div>
            <span class="share-link-code">${link.code}</span>
            <span class="share-link-meta">
              Created ${formatDate(link.created_at)}
              ${link.expires_at ? ' \u00b7 Expires ' + formatDate(link.expires_at) : ' \u00b7 No expiry'}
              ${!isActive ? ' \u00b7 Revoked' : ''}
            </span>
          </div>
          <div style="display:flex; gap:4px;">
            ${isActive ? `
              <button class="btn btn-ghost btn-sm" onclick="window._app.copyShareUrl('${escAttr(shareUrl)}')" title="Copy link"><i class="fa-solid fa-copy"></i></button>
              <button class="btn btn-ghost btn-sm" onclick="window._app.revokeShare('${link.code}')" title="Revoke"><i class="fa-solid fa-ban"></i></button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderSettingsModal() {
    const p = state.patientInfo;
    return `
      <div class="modal-overlay" onclick="window._app.closeModal(event)">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2><i class="fa-solid fa-gear"></i> Settings</h2>
            <button class="modal-close" onclick="window._app.closeModal()">&times;</button>
          </div>
          <form id="settingsForm" onsubmit="window._app.submitSettings(event)">
            <div class="modal-body">
              <div class="settings-section">
                <h3><i class="fa-solid fa-user"></i> Patient Information</h3>
                <p style="font-size:0.82rem; color:var(--gray-400); margin-bottom:16px;">
                  This information appears on shared reports. Your <strong>date of birth</strong> is required for doctor sharing \u2014 it's used for identity verification.
                </p>
                <div class="form-group">
                  <label class="form-label">Full Name</label>
                  <input class="form-input" name="name" value="${escAttr(p.name)}" placeholder="Your full name">
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Date of Birth <span class="required">*</span></label>
                    <input class="form-input" type="date" name="dob" value="${escAttr(p.dob)}">
                    <div class="form-hint">Required for doctor sharing verification</div>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Blood Type</label>
                    <select class="form-select" name="blood_type">
                      <option value="">Select\u2026</option>
                      ${['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bt =>
                        `<option value="${bt}" ${p.blood_type === bt ? 'selected' : ''}>${bt}</option>`
                      ).join('')}
                    </select>
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">Known Allergies</label>
                  <textarea class="form-textarea" name="allergies" placeholder="e.g., Penicillin, Latex, Iodine\u2026" style="min-height:60px">${escHtml(p.allergies)}</textarea>
                </div>
              </div>

              <div class="settings-section">
                <h3><i class="fa-solid fa-database"></i> Data Management</h3>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                  <button type="button" class="btn btn-ghost btn-sm" onclick="window._app.exportData()"><i class="fa-solid fa-download"></i> Export JSON</button>
                  <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('importFile').click()"><i class="fa-solid fa-upload"></i> Import JSON</button>
                  <input type="file" id="importFile" accept=".json" style="display:none" onchange="window._app.importData(event)">
                </div>
              </div>

              <div class="settings-section">
                <h3><i class="fa-solid fa-user-gear"></i> Account</h3>
                <p style="font-size:0.82rem; color:var(--gray-500); margin-bottom:10px;">Signed in as <strong>${escHtml(getUserEmail())}</strong></p>
                <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="window._app.logout()"><i class="fa-solid fa-right-from-bracket"></i> Sign Out</button>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-ghost" onclick="window._app.closeModal()">Cancel</button>
              <button type="submit" class="btn btn-blue"><i class="fa-solid fa-check"></i> Save Settings</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function renderDetailModal() {
    const s = state.surgeries.find(s => s.id === state.viewingId);
    if (!s) return '';

    const docs = state.documentsCache[s.id] || [];

    const fields = [
      ['Procedure', s.name],
      ['Date', formatDate(s.date)],
      ['Category', s.category],
      ['Surgeon', s.surgeon],
      ['Hospital / Clinic', s.hospital],
      ['Body Region', s.body_region],
      ['Anesthesia', s.anesthesia],
      ['Duration', s.duration],
      ['Urgency', s.urgency ? s.urgency.charAt(0).toUpperCase() + s.urgency.slice(1) : ''],
      ['Setting', s.setting ? s.setting.charAt(0).toUpperCase() + s.setting.slice(1) : ''],
    ].filter(([, v]) => v);

    return `
      <div class="modal-overlay" onclick="window._app.closeModal(event)">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h2><i class="fa-solid fa-clipboard"></i> Surgery Details</h2>
            <button class="modal-close" onclick="window._app.closeModal()">&times;</button>
          </div>
          <div class="modal-body">
            <div style="display:grid; grid-template-columns: 160px 1fr; gap: 8px 16px;">
              ${fields.map(([label, value]) => `
                <div style="font-size:0.82rem; font-weight:600; color:var(--gray-500);">${label}</div>
                <div style="font-size:0.9rem; color:var(--gray-800);">${escHtml(value)}</div>
              `).join('')}
            </div>

            ${s.notes ? `
              <div style="margin-top:20px;">
                <div style="font-size:0.82rem; font-weight:600; color:var(--gray-500); margin-bottom:6px;">Notes</div>
                <div class="surgery-notes-text">${escHtml(s.notes)}</div>
              </div>
            ` : ''}

            ${s.had_complications ? `
              <div style="margin-top:16px;">
                <div style="font-size:0.82rem; font-weight:600; color:#ea580c; margin-bottom:6px;"><i class="fa-solid fa-triangle-exclamation"></i> Complications</div>
                <div class="surgery-notes-text" style="border-color:#fed7aa; background:#fff7ed;">${escHtml(s.complications || 'Yes (no details provided)')}</div>
              </div>
            ` : ''}

            ${docs.length > 0 ? `
              <div style="margin-top:20px;">
                <div style="font-size:0.82rem; font-weight:600; color:var(--gray-500); margin-bottom:8px;"><i class="fa-solid fa-paperclip"></i> Documents (${docs.length})</div>
                <div class="document-list">
                  ${docs.map(doc => `
                    <div class="document-item">
                      <div class="document-item-info">
                        <i class="fa-solid ${getFileIcon(doc.mime_type)}"></i>
                        <span class="document-item-name">${escHtml(doc.filename)}</span>
                        <span class="document-item-size">${formatFileSize(doc.size)}</span>
                      </div>
                      <div class="document-item-actions">
                        <button class="btn btn-ghost btn-sm" onclick="window._app.downloadDoc('${doc.id}')" title="Download"><i class="fa-solid fa-download"></i></button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="window._app.closeModal()">Close</button>
            <button class="btn btn-blue" onclick="window._app.openEdit('${s.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
          </div>
        </div>
      </div>
    `;
  }

  // ---- Filtering & Sorting ----
  function getFilteredSurgeries() {
    let list = [...state.surgeries];

    if (state.searchQuery.trim()) {
      const q = state.searchQuery.toLowerCase();
      list = list.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.surgeon || '').toLowerCase().includes(q) ||
        (s.hospital || '').toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q) ||
        (s.notes || '').toLowerCase().includes(q) ||
        (s.body_region || '').toLowerCase().includes(q)
      );
    }

    switch (state.sortBy) {
      case 'date-desc': list.sort((a, b) => new Date(b.date) - new Date(a.date)); break;
      case 'date-asc': list.sort((a, b) => new Date(a.date) - new Date(b.date)); break;
      case 'name-asc': list.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'name-desc': list.sort((a, b) => b.name.localeCompare(a.name)); break;
    }

    return list;
  }

  // ---- Data Loading ----
  async function loadData() {
    state.dataLoading = true;
    try {
      const [surgeriesResp, patientResp] = await Promise.all([
        apiJson('/api/surgeries'),
        apiJson('/api/patient-info'),
      ]);

      state.surgeries = surgeriesResp.surgeries || [];
      state.patientInfo = patientResp.patient_info || { name: '', dob: '', blood_type: '', allergies: '' };

      // Load documents for all surgeries
      if (state.surgeries.length > 0) {
        const docPromises = state.surgeries.map(s =>
          apiJson(`/api/surgeries/${s.id}/documents`).then(resp => {
            state.documentsCache[s.id] = resp.documents || [];
          }).catch(() => {
            state.documentsCache[s.id] = [];
          })
        );
        await Promise.all(docPromises);
      }

      state.dataLoaded = true;
    } catch (err) {
      console.error('Failed to load data:', err);
      if (getToken()) {
        showToast('Failed to load data. Please refresh.', 'error');
      }
    } finally {
      state.dataLoading = false;
      render();
    }
  }

  // ---- Auth Actions ----
  function switchAuth(screen) {
    state.authScreen = screen;
    state.authError = '';
    render();
  }

  async function submitAuth(e) {
    e.preventDefault();
    state.authError = '';
    state.authLoading = true;
    render();

    const fd = new FormData(e.target);
    const email = fd.get('email').trim();
    const password = fd.get('password');

    if (state.authScreen === 'register') {
      const confirmPassword = fd.get('confirmPassword');
      if (password !== confirmPassword) {
        state.authError = 'Passwords do not match.';
        state.authLoading = false;
        render();
        return;
      }
    }

    try {
      const endpoint = state.authScreen === 'register' ? '/api/auth/register' : '/api/auth/login';
      const data = await apiJson(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      setToken(data.token);
      setUserEmail(data.user.email);
      state.authScreen = null;
      state.authLoading = false;
      state.dataLoaded = false;
      state.dataLoading = false;
      render();
    } catch (err) {
      state.authError = err.message;
      state.authLoading = false;
      render();
    }
  }

  function logout() {
    clearToken();
    localStorage.removeItem('surgery_tracker_email');
    state.authScreen = 'login';
    state.dataLoaded = false;
    state.dataLoading = false;
    state.surgeries = [];
    state.patientInfo = { name: '', dob: '', blood_type: '', allergies: '' };
    state.documentsCache = {};
    state.shareLinks = [];
    state.shareLinksLoaded = false;
    state.currentModal = null;
    render();
  }

  // ---- DOB Verification (Doctor) ----
  async function submitDobVerify(e) {
    e.preventDefault();
    state.shareError = '';
    state.shareLoading = true;
    render();

    const fd = new FormData(e.target);
    const dob = fd.get('dob');

    try {
      const data = await apiJson(`/api/share/${state.shareCode}/verify`, {
        method: 'POST',
        body: JSON.stringify({ dob }),
      });

      state.shareVerified = true;
      state.shareData = data;
      state.shareLoading = false;
      render();
    } catch (err) {
      state.shareError = err.message;
      state.shareLoading = false;
      render();
    }
  }

  // ---- Modal Actions ----
  function openAdd() { state.currentModal = 'add'; state.editingId = null; render(); }
  function openEdit(id) { state.currentModal = 'edit'; state.editingId = id; render(); }
  function openDelete(id) { state.currentModal = 'delete'; state.deletingId = id; render(); }
  function openDetail(id) { state.currentModal = 'detail'; state.viewingId = id; render(); }

  async function openShare() {
    state.currentModal = 'share';
    render();

    if (!state.shareLinksLoaded) {
      try {
        const data = await apiJson('/api/share/links');
        state.shareLinks = data.share_links || [];
        state.shareLinksLoaded = true;
        render();
      } catch (err) {
        console.error('Failed to load share links:', err);
        state.shareLinksLoaded = true;
        render();
      }
    }
  }

  function openSettings() { state.currentModal = 'settings'; render(); }

  function closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    state.currentModal = null;
    state.editingId = null;
    state.deletingId = null;
    state.viewingId = null;
    render();
  }

  // ---- Surgery CRUD ----
  async function submitForm(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: fd.get('name').trim(),
      date: fd.get('date'),
      surgeon: fd.get('surgeon').trim(),
      hospital: fd.get('hospital').trim(),
      category: fd.get('category'),
      anesthesia: fd.get('anesthesia'),
      duration: fd.get('duration').trim(),
      urgency: fd.get('urgency'),
      setting: fd.get('setting'),
      body_region: fd.get('body_region').trim(),
      had_complications: fd.get('had_complications') === 'on',
      complications: fd.get('complications')?.trim() || '',
      notes: fd.get('notes').trim(),
    };

    try {
      if (state.editingId) {
        const resp = await apiJson(`/api/surgeries/${state.editingId}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
        const idx = state.surgeries.findIndex(s => s.id === state.editingId);
        if (idx !== -1) state.surgeries[idx] = resp.surgery;
        showToast('Surgery updated successfully!');
      } else {
        const resp = await apiJson('/api/surgeries', {
          method: 'POST',
          body: JSON.stringify(data),
        });
        state.surgeries.push(resp.surgery);
        state.documentsCache[resp.surgery.id] = [];
        showToast('Surgery added successfully!');
      }
      state.currentModal = null;
      state.editingId = null;
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function confirmDelete() {
    try {
      await apiJson(`/api/surgeries/${state.deletingId}`, { method: 'DELETE' });
      state.surgeries = state.surgeries.filter(s => s.id !== state.deletingId);
      delete state.documentsCache[state.deletingId];
      state.currentModal = null;
      state.deletingId = null;
      showToast('Surgery deleted.');
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ---- Settings ----
  async function submitSettings(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: fd.get('name').trim(),
      dob: fd.get('dob'),
      blood_type: fd.get('blood_type'),
      allergies: fd.get('allergies').trim(),
    };

    try {
      const resp = await apiJson('/api/patient-info', {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      state.patientInfo = resp.patient_info;
      state.currentModal = null;
      showToast('Settings saved!');
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ---- Share Link Management ----
  async function createShareLink() {
    try {
      const data = await apiJson('/api/share', {
        method: 'POST',
        body: JSON.stringify({ expires_in: 'never' }),
      });
      state.shareLinks.unshift(data.share_link);
      render();
      const shareUrl = window.location.origin + '/#/share/' + data.share_link.code;
      copyToClipboard(shareUrl);
      showToast('Share link created and copied!');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function revokeShare(code) {
    if (!confirm('Revoke this share link? The doctor will no longer be able to access your data through it.')) return;
    try {
      await apiJson(`/api/share/${code}`, { method: 'DELETE' });
      const idx = state.shareLinks.findIndex(l => l.code === code);
      if (idx !== -1) state.shareLinks[idx].active = 0;
      showToast('Share link revoked.');
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function copyShareUrl(url) {
    copyToClipboard(url);
    showToast('Link copied to clipboard!');
  }

  // ---- Document Management ----
  async function uploadDocument(e, surgeryId) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > 10 * 1024 * 1024) {
      showToast('File too large. Maximum size is 10MB.', 'error');
      return;
    }

    state.uploadingDoc = true;
    render();

    try {
      const formData = new FormData();
      formData.append('file', file);

      const data = await apiJson(`/api/surgeries/${surgeryId}/documents`, {
        method: 'POST',
        body: formData,
      });

      if (!state.documentsCache[surgeryId]) state.documentsCache[surgeryId] = [];
      state.documentsCache[surgeryId].push(data.document);
      showToast('Document uploaded!');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      state.uploadingDoc = false;
      render();
    }
  }

  async function downloadDoc(docId) {
    try {
      const resp = await api(`/api/documents/${docId}/download`);
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || 'Download failed.');
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match ? match[1] : 'document';

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function downloadSharedDoc(docId) {
    try {
      const url = `${API_BASE}/api/share/documents/${docId}/download?user_id=${state.shareData.user_id}&code=${state.shareCode}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error('Download failed.');
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match ? match[1] : 'document';

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteDoc(docId, surgeryId) {
    if (!confirm('Delete this document?')) return;
    try {
      await apiJson(`/api/documents/${docId}`, { method: 'DELETE' });
      if (state.documentsCache[surgeryId]) {
        state.documentsCache[surgeryId] = state.documentsCache[surgeryId].filter(d => d.id !== docId);
      }
      showToast('Document deleted.');
      render();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ---- Export / Import ----
  function exportData() {
    const data = {
      patient: state.patientInfo,
      surgeries: state.surgeries,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `surgery-history-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async function (ev) {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.surgeries || !Array.isArray(data.surgeries)) {
          alert('Invalid file format. Expected a Surgery Tracker export file.');
          return;
        }
        if (!confirm(`Import ${data.surgeries.length} surgeries? Each will be added to your account.`)) return;

        // Import patient info
        if (data.patient) {
          await apiJson('/api/patient-info', {
            method: 'PUT',
            body: JSON.stringify({
              name: data.patient.name || data.patient.name || '',
              dob: data.patient.dob || '',
              blood_type: data.patient.bloodType || data.patient.blood_type || '',
              allergies: data.patient.allergies || '',
            }),
          });
        }

        // Import surgeries one by one
        let imported = 0;
        for (const s of data.surgeries) {
          try {
            await apiJson('/api/surgeries', {
              method: 'POST',
              body: JSON.stringify({
                name: s.name || 'Unknown',
                date: s.date || new Date().toISOString().split('T')[0],
                surgeon: s.surgeon || '',
                hospital: s.hospital || '',
                category: s.category || '',
                anesthesia: s.anesthesia || '',
                duration: s.duration || '',
                urgency: s.urgency || 'elective',
                setting: s.setting || 'inpatient',
                body_region: s.bodyRegion || s.body_region || '',
                had_complications: s.hadComplications || s.had_complications || false,
                complications: s.complications || '',
                notes: s.notes || '',
              }),
            });
            imported++;
          } catch (err) {
            console.error('Failed to import surgery:', s.name, err);
          }
        }

        showToast(`Imported ${imported} surgeries!`);
        state.dataLoaded = false;
        state.dataLoading = false;
        state.currentModal = null;
        render();
      } catch {
        alert('Could not parse the file. Make sure it is a valid JSON export.');
      }
    };
    reader.readAsText(file);
  }

  // ---- Search / Sort ----
  function setSearch(val) { state.searchQuery = val; render(); }
  function setSort(val) { state.sortBy = val; render(); }

  // ---- Toast ----
  function showToast(msg, type = 'success') {
    const existing = document.querySelector('.copy-toast');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'copy-toast';
    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
    div.innerHTML = `<i class="fa-solid ${icon}"></i> ${escHtml(msg)}`;
    if (type === 'error') {
      div.style.background = 'var(--danger)';
    }
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 2200);
  }

  // ---- Clipboard ----
  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // ---- Keyboard shortcuts ----
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.currentModal) {
      closeModal();
    }
  });

  // ---- Utility ----
  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return dateStr; }
  }

  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getFileIcon(mimeType) {
    if (!mimeType) return 'fa-file';
    if (mimeType === 'application/pdf') return 'fa-file-pdf';
    if (mimeType.startsWith('image/')) return 'fa-file-image';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'fa-file-word';
    if (mimeType === 'text/plain') return 'fa-file-lines';
    return 'fa-file';
  }

  // ---- Event Binding ----
  function bindEvents() {
    const searchInput = document.querySelector('.search-box input');
    if (searchInput && state.searchQuery) {
      searchInput.focus();
      searchInput.setSelectionRange(state.searchQuery.length, state.searchQuery.length);
    }
  }

  // ---- Public API ----
  window._app = {
    openAdd, openEdit, openDelete, openShare, openSettings, openDetail,
    closeModal, submitForm, confirmDelete, submitSettings,
    copyShareUrl, createShareLink, revokeShare,
    setSearch, setSort, exportData, importData,
    switchAuth, submitAuth, logout,
    submitDobVerify,
    uploadDocument, downloadDoc, downloadSharedDoc, deleteDoc,
  };

  // ---- Init ----
  render();
})();
