/**
 * Generates the safe, DOM-isolated widget loader script
 */
export const buildWidgetLoaderScript = (widgetId: string, apiBaseUrl: string): string => {
  // Sanitize widgetId to guarantee only valid UUID characters are embedded in script
  const sanitizedId = widgetId.replace(/[^a-zA-Z0-9-]/g, '');
  const sanitizedApiUrl = apiBaseUrl.replace(/\/+$/, '');

  return `/**
 * FlyRank Embeddable Lead-Capture Widget
 * Widget ID: ${sanitizedId}
 */
(function() {
  'use strict';

  var WIDGET_ID = "${sanitizedId}";
  var API_BASE_URL = "${sanitizedApiUrl}";
  var CONTAINER_SELECTOR = '[data-flyrank-widget="' + WIDGET_ID + '"]';

  // Prevent duplicate initialization on the host page
  if (document.querySelector(CONTAINER_SELECTOR)) {
    return;
  }

  // Create isolated container
  var container = document.createElement('div');
  container.setAttribute('data-flyrank-widget', WIDGET_ID);
  container.className = 'flyrank-widget-card';

  // Inject scoped stylesheet
  var style = document.createElement('style');
  style.textContent = [
    CONTAINER_SELECTOR + ' {',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
    '  max-width: 440px;',
    '  margin: 16px auto;',
    '  padding: 24px;',
    '  border-radius: 12px;',
    '  background: #ffffff;',
    '  color: #111827;',
    '  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);',
    '  border: 1px solid #e5e7eb;',
    '  box-sizing: border-box;',
    '}',
    CONTAINER_SELECTOR + ' * { box-sizing: border-box; }',
    CONTAINER_SELECTOR + ' .flyrank-title {',
    '  font-size: 1.25rem;',
    '  font-weight: 700;',
    '  margin: 0 0 16px 0;',
    '  color: #111827;',
    '}',
    CONTAINER_SELECTOR + ' .flyrank-field-group {',
    '  margin-bottom: 14px;',
    '}',
    CONTAINER_SELECTOR + ' .flyrank-label {',
    '  display: block;',
    '  font-size: 0.875rem;',
    '  font-weight: 600;',
    '  margin-bottom: 6px;',
    '  color: #374151;',
    '}',
    CONTAINER_SELECTOR + ' .flyrank-input, ' + CONTAINER_SELECTOR + ' .flyrank-textarea {',
    '  width: 100%;',
    '  padding: 10px 14px;',
    '  border: 1px solid #d1d5db;',
    '  border-radius: 6px;',
    '  font-size: 0.95rem;',
    '  outline: none;',
    '  transition: border-color 0.15s ease;',
    '}',
    CONTAINER_SELECTOR + ' .flyrank-input:focus, ' + CONTAINER_SELECTOR + ' .flyrank-textarea:focus {',
    '  border-color: #2563eb;',
    '  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);',
    '}',
    CONTAINER_SELECTOR + ' .flyrank-textarea {',
    '  resize: vertical;',
    '  min-height: 80px;',
    '}',
    CONTAINER_SELECTOR + ' .flyrank-btn {',
    '  width: 100%;',
    '  padding: 12px 18px;',
    '  border: none;',
    '  border-radius: 6px;',
    '  font-size: 1rem;',
    '  font-weight: 600;',
    '  color: #ffffff;',
    '  cursor: pointer;',
    '  transition: opacity 0.15s ease;',
    '}',
    CONTAINER_SELECTOR + ' .flyrank-btn:hover { opacity: 0.92; }',
    CONTAINER_SELECTOR + ' .flyrank-alert {',
    '  padding: 12px;',
    '  border-radius: 6px;',
    '  font-size: 0.875rem;',
    '  margin-top: 14px;',
    '}',
    CONTAINER_SELECTOR + ' .flyrank-alert-success {',
    '  background: #ecfdf5;',
    '  color: #065f46;',
    '  border: 1px solid #a7f3d0;',
    '}',
    CONTAINER_SELECTOR + ' .flyrank-alert-error {',
    '  background: #fef2f2;',
    '  color: #991b1b;',
    '  border: 1px solid #fecaca;',
    '}',
  ].join('\\n');
  document.head.appendChild(style);

  // Loading indicator
  var loadingEl = document.createElement('div');
  loadingEl.textContent = 'Loading lead capture widget...';
  loadingEl.style.cssText = 'color: #6b7280; font-size: 0.875rem; text-align: center; padding: 12px;';
  container.appendChild(loadingEl);

  // Mount container to DOM
  var targetScript = document.currentScript;
  if (targetScript && targetScript.parentNode) {
    targetScript.parentNode.insertBefore(container, targetScript);
  } else {
    document.body.appendChild(container);
  }

  // Fetch widget configuration cross-origin
  var configUrl = API_BASE_URL + '/api/v1/public/widgets/' + WIDGET_ID + '/config';

  fetch(configUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  })
  .then(function(res) {
    if (!res.ok) {
      throw new Error('Failed to load widget (HTTP ' + res.status + ')');
    }
    return res.json();
  })
  .then(function(payload) {
    var config = payload.data;
    renderWidgetForm(container, config);
  })
  .catch(function(err) {
    container.textContent = '';
    var errorEl = document.createElement('div');
    errorEl.className = 'flyrank-alert flyrank-alert-error';
    errorEl.textContent = 'Unable to display widget. ' + err.message;
    container.appendChild(errorEl);
  });

  // Safe DOM Form Renderer (XSS-safe: uses textContent and createElement exclusively)
  function renderWidgetForm(root, config) {
    root.textContent = '';

    var form = document.createElement('form');
    form.className = 'flyrank-form';
    form.noValidate = true;

    // Title
    var title = document.createElement('h3');
    title.className = 'flyrank-title';
    title.textContent = config.name || 'Get in Touch';
    form.appendChild(title);

    // Dynamic Fields
    var fields = config.fields || [];
    var inputRefs = {};

    fields.forEach(function(field) {
      var group = document.createElement('div');
      group.className = 'flyrank-field-group';

      var label = document.createElement('label');
      label.className = 'flyrank-label';
      label.textContent = field.label + (field.required ? ' *' : '');
      group.appendChild(label);

      var input;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.className = 'flyrank-textarea';
      } else {
        input = document.createElement('input');
        input.type = field.type === 'email' ? 'email' : 'text';
        input.className = 'flyrank-input';
      }

      input.name = field.name;
      input.required = Boolean(field.required);
      group.appendChild(input);
      form.appendChild(group);

      inputRefs[field.name] = { el: input, config: field };
    });

    // Submit button with configured theme
    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'flyrank-btn';
    submitBtn.textContent = (config.theme && config.theme.buttonText) ? config.theme.buttonText : 'Submit';
    if (config.theme && config.theme.primaryColor) {
      submitBtn.style.backgroundColor = config.theme.primaryColor;
    } else {
      submitBtn.style.backgroundColor = '#111827';
    }
    form.appendChild(submitBtn);

    // Status message container
    var statusAlert = document.createElement('div');
    statusAlert.style.display = 'none';
    form.appendChild(statusAlert);

    // Form submission handler (Phase 2B local validation demo)
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      statusAlert.style.display = 'none';
      statusAlert.className = 'flyrank-alert';

      // Local validation
      var hasErrors = false;
      var firstError = '';

      fields.forEach(function(field) {
        var ref = inputRefs[field.name];
        var val = (ref && ref.el.value) ? ref.el.value.trim() : '';

        if (field.required && !val) {
          hasErrors = true;
          if (!firstError) firstError = field.label + ' is required.';
        } else if (field.type === 'email' && val && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(val)) {
          hasErrors = true;
          if (!firstError) firstError = 'Please enter a valid email address.';
        }
      });

      if (hasErrors) {
        statusAlert.className = 'flyrank-alert flyrank-alert-error';
        statusAlert.textContent = firstError;
        statusAlert.style.display = 'block';
        return;
      }

      // Success confirmation state for Phase 2B
      form.textContent = '';
      var successBox = document.createElement('div');
      successBox.className = 'flyrank-alert flyrank-alert-success';
      successBox.textContent = 'Thank you! The form was rendered and validated successfully. (Lead capture ingestion activates in Phase 2C).';
      form.appendChild(successBox);
    });

    root.appendChild(form);
  }
})();
`;
};
