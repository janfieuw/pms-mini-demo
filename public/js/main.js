
document.addEventListener('DOMContentLoaded', () => {
  // info chips multi-select
  const chipGroup = document.querySelector('.chips[data-chip-group="info"]');
  if (chipGroup) {
    const hidden = document.querySelector('input[name="infoLabels"]');
    chipGroup.addEventListener('click', (e) => {
      if (e.target.classList.contains('chip')) {
        e.target.classList.toggle('active');
        const values = Array.from(chipGroup.querySelectorAll('.chip.active')).map(c => c.dataset.value);
        hidden.value = values.join(',');
      }
    });
  }
});


document.addEventListener('DOMContentLoaded', () => {
  const sw = document.querySelector('.chips[data-chip-group="software"]');
  if (sw) {
    const hidden = document.querySelector('input[name="softwareLabels"]');
    sw.addEventListener('click', (e) => {
      if (e.target.classList.contains('chip')) {
        e.target.classList.toggle('active');
        const values = Array.from(sw.querySelectorAll('.chip.active')).map(c => c.dataset.value);
        hidden.value = values.join(',');
      }
    });
  }
});


  // TO-DO button: open external link and remove task (fire-and-forget)
  document.body.addEventListener('click', (e) => {
    const a = e.target.closest('a.arrow-btn');
    if (!a || !a.matches('.arrow-btn')) return;
    // Only for to-do list items
    const li = a.closest('li');
    const del = a.getAttribute('data-delete');
    if (del) {
      try {
        const payload = new Blob([JSON.stringify({})], { type: 'application/json' });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(del, payload);
        } else {
          fetch(del, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        }
      } catch(err){ console.error('delete todo failed', err); }
      if (li && li.parentElement) li.parentElement.removeChild(li);
      // Do NOT prevent default; link opens in new tab via target=_blank
    }
  });

