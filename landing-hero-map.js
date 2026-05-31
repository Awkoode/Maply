/**
 * Landing — mapa do hero: pan + pin sincronizados com ocorrências
 */
(function () {
  const SCENES = [
    { place: 'Centro', pan: { x: 0, y: 0 }, pin: { x: 46, y: 50 }, duration: 5200 },
    { place: 'Trindade', pan: { x: -24, y: -16 }, pin: { x: 64, y: 44 }, duration: 5200 },
    { place: 'Lagoa da Conceição', pan: { x: -14, y: 20 }, pin: { x: 40, y: 62 }, duration: 5200 },
    { place: 'Ingleses', pan: { x: -30, y: 10 }, pin: { x: 70, y: 40 }, duration: 5200 }
  ];

  const TRANSITION_MS = 1100;
  let sceneIndex = 0;
  let timerId = null;

  function setScene(index) {
    const i = index % SCENES.length;
    const scene = SCENES[i];
    const demo = document.querySelector('.hero-map-demo');
    if (!demo) return;

    const surface = document.getElementById('hero-map-surface');
    const pin = document.getElementById('hero-map-pin');
    const placeEl = document.getElementById('hero-map-place');

    if (surface) {
      surface.style.transform = `translate(${scene.pan.x}%, ${scene.pan.y}%)`;
    }
    if (pin) {
      pin.style.left = `${scene.pin.x}%`;
      pin.style.top = `${scene.pin.y}%`;
    }
    if (placeEl) {
      placeEl.style.opacity = '0';
      window.setTimeout(() => {
        placeEl.textContent = scene.place;
        placeEl.style.opacity = '1';
      }, TRANSITION_MS * 0.35);
    }

    demo.querySelectorAll('.hero-map-card').forEach(card => {
      card.classList.toggle('is-active', Number(card.dataset.scene) === i);
    });
  }

  function scheduleNext() {
    clearTimeout(timerId);
    timerId = setTimeout(() => {
      sceneIndex = (sceneIndex + 1) % SCENES.length;
      setScene(sceneIndex);
      scheduleNext();
    }, SCENES[sceneIndex].duration);
  }

  function init() {
    const surface = document.getElementById('hero-map-surface');
    const pin = document.getElementById('hero-map-pin');
    const placeEl = document.getElementById('hero-map-place');

    if (surface) {
      surface.style.transition = `transform ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    }
    if (pin) {
      pin.style.transition = `left ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1), top ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    }
    if (placeEl) {
      placeEl.style.transition = 'opacity .4s ease';
    }

    setScene(0);
    scheduleNext();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
