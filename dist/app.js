'use strict';
const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('#main-nav');
function closeMenu(restoreFocus = false) {
  const wasOpen = menu.getAttribute('aria-expanded') === 'true';
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-label', 'Open navigation');
  nav.classList.remove('is-open');
  if (restoreFocus && wasOpen) menu.focus();
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  nav.classList.toggle('is-open', open);
});
nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => closeMenu()));
document.addEventListener('click', event => { if (!event.target.closest('.site-header')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(true); });
window.matchMedia('(min-width: 701px)').addEventListener('change', () => closeMenu());
window.addEventListener('hashchange', () => closeMenu());

const dialog = document.querySelector('#gallery-dialog');
const photos = [
  ['facebook-bucket-crew', 'Tree work — a Lavish crew member in an elevated bucket. Original photo from Lavish’s Facebook page.'],
  ['stump-grinding', 'Stump grinding — Lavish equipment at a residential property.'],
  ['storm-home', 'Storm response — a fallen tree beside a home with Lavish equipment on site.']
];
let photoIndex = 0;
let galleryTrigger = null;
function showPhoto(index) {
  photoIndex = (index + photos.length) % photos.length;
  const [file, caption] = photos[photoIndex];
  const image = document.querySelector('#gallery-image');
  image.src = `assets/${file}.webp`;
  image.alt = caption;
  document.querySelector('#gallery-caption').textContent = caption;
  document.querySelector('#gallery-count').textContent = `${photoIndex + 1} / ${photos.length}`;
}
document.querySelectorAll('[data-gallery]').forEach(button => button.addEventListener('click', () => {
  galleryTrigger = button;
  showPhoto(Number(button.dataset.gallery));
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('dialog-open');
}));
document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
document.querySelector('#gallery-prev').addEventListener('click', () => showPhoto(photoIndex - 1));
document.querySelector('#gallery-next').addEventListener('click', () => showPhoto(photoIndex + 1));
dialog.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') { event.preventDefault(); showPhoto(photoIndex - 1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); showPhoto(photoIndex + 1); }
});
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
dialog.addEventListener('close', () => {
  document.body.classList.remove('dialog-open');
  galleryTrigger?.focus({ preventScroll: true });
});

document.querySelectorAll('[data-service]').forEach(link => link.addEventListener('click', () => {
  document.querySelector('#service-choice').value = link.dataset.service;
}));
document.querySelector('#quote-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  document.querySelector('#request-summary').textContent = [
    ['Name', 'name'], ['Phone', 'phone'], ['Email', 'email'], ['Service', 'service'], ['Property', 'address'], ['Details', 'message']
  ].map(([label, name]) => `${label}: ${data.get(name) || 'Not provided'}`).join('\n');
  const result = document.querySelector('#form-result');
  result.hidden = false;
  result.focus({ preventScroll: true });
  result.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
});
document.querySelector('.form-submit').disabled = false;
document.querySelector('#year').textContent = String(new Date().getFullYear());
