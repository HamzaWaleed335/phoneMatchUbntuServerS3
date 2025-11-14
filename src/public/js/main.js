function wireUpload(formId, progressId) {
  const form = document.getElementById(formId);
  const progressWrap = document.getElementById(progressId);
  if (!form || !progressWrap) return;

  // Prevent double-binding if script gets included twice
  if (form.dataset.wired === "1") return;
  form.dataset.wired = "1";

  const bar = progressWrap.querySelector('.progress-bar');
  const pct = progressWrap.querySelector('[data-percent]');
  const status = progressWrap.querySelector('[data-status]');

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const fileInput = form.querySelector('input[type="file"]');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      alert('Please choose a file first.');
      return;
    }

    progressWrap.classList.remove('d-none');
    bar.style.width = '0%';
    pct.textContent = '0';
    status.textContent = 'Starting upload…';

    const xhr = new XMLHttpRequest();
    let completed = false; // guard to ignore abort/error after success

    xhr.open('POST', form.action, true);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.responseType = 'json';
    xhr.timeout = 0; // no timeout; long server processing is okay

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const percent = Math.round((ev.loaded / ev.total) * 100);
        bar.style.width = percent + '%';
        pct.textContent = String(percent);
        status.textContent = percent < 100 ? 'Uploading…' : 'Processing on server…';
      } else {
        status.textContent = 'Uploading…';
      }
    };

    xhr.onload = () => {
      completed = true;
      const res = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300 && res && res.redirect) {
        status.textContent = 'Done. Redirecting…';
        window.location.href = res.redirect;
      } else if (xhr.status >= 200 && xhr.status < 300) {
        // Fallback: success but no JSON redirect
        status.textContent = 'Done.';
        window.location.reload();
      } else {
        status.textContent = 'Server error.';
        alert((res && res.error) || 'Server error. Check logs.');
      }
    };

    // Abort happens if the page navigates away (e.g., after success redirect): don't alert.
    xhr.onabort = () => {
      if (!completed) {
        // Silent: user navigated away or request aborted; no need to alarm.
      }
    };

    // Network errors; ignore if we already completed (e.g., race with redirect)
    xhr.onerror = () => {
      if (!completed) {
        status.textContent = 'Upload failed.';
        alert('Upload failed. Please try again.');
      }
    };

    // Optional: only alert on timeout if not completed
    xhr.ontimeout = () => {
      if (!completed) {
        status.textContent = 'Upload timed out.';
        alert('Upload timed out. Please try again.');
      }
    };

    const data = new FormData(form);
    xhr.send(data);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  wireUpload('adminUploadForm', 'adminUploadProgress');
  wireUpload('clientUploadForm', 'clientUploadProgress');
});
