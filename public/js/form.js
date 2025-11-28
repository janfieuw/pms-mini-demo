// Form validation for MUST READ and SAFETY (2025-10-28b)
// Blocks submit if no message text for those labels.
(function(){
  const form = document.getElementById('logForm');
  if (!form) return;

  form.addEventListener('submit', function(e){
    const checked = document.querySelector('input[name="label"]:checked');
    const label = checked ? (checked.value || '').toUpperCase() : '';
    const msgEl = document.getElementById('message');
    const text = (msgEl && msgEl.value) ? msgEl.value.trim() : '';

    if ((label === 'MUST READ' || label === 'SAFETY') && text === '') {
      e.preventDefault();
      alert('Voor MUST READ en SAFETY is een bericht verplicht.');
      if (msgEl) msgEl.focus();
    }
  });
})();
