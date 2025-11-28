// public/js/logbook-form-realtime-required.js
// v3: support input[name="when"], freeze after user edit + required message
(function () {
  function onReady(fn){ if(document.readyState!=='loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
  onReady(function () {
    const form = document.querySelector('form.form, form#logbookForm, form[action*="/logbook"], form[data-domain="logbook"]') || document.querySelector('form');
    if (!form) return;

    // Required message text (runtime, no EJS edits)
    let textField = form.querySelector('textarea[name="message"], textarea, input[name="message"]');
    if (textField) {
      textField.setAttribute('required', 'required');
      if (!textField.getAttribute('placeholder') || /optional/i.test(textField.getAttribute('placeholder'))) {
        textField.setAttribute('placeholder', 'Required text...');
      }
    }
    form.addEventListener('submit', function (e) {
      if (textField && !String(textField.value).trim()) {
        e.preventDefault();
        textField.focus();
        textField.setAttribute('aria-invalid', 'true');
        if (!textField.nextElementSibling || !textField.nextElementSibling.classList || !textField.nextElementSibling.classList.contains('field-error')) {
          const small = document.createElement('small');
          small.className = 'field-error';
          small.style.display = 'block';
          small.style.marginTop = '6px';
          small.textContent = 'Text is required.';
          textField.insertAdjacentElement('afterend', small);
        }
      }
    });

    // Realtime time input with "freeze after user edit"
    const timeInput = form.querySelector('input[type="time"], #timeInput, input[name="time"], input[name="when"]');
    if (timeInput) {
      let userEdited = false;
      function updateTime() {
        if (userEdited) return;
        if (document.activeElement === timeInput) return;
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        timeInput.value = `${hours}:${minutes}`;
      }
      ['input', 'change', 'keyup', 'blur'].forEach(evt => {
        timeInput.addEventListener(evt, () => { userEdited = true; }, { passive: true });
      });
      updateTime();
      setInterval(updateTime, 1000);
    }
  });
})();
