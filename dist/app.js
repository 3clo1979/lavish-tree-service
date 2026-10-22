"use strict";
const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('#main-nav');
function closeMenu(){ menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open navigation');nav.classList.remove('is-open'); }
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');nav.classList.toggle('is-open',open);});
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
document.querySelectorAll('[data-service]').forEach(a=>a.addEventListener('click',()=>document.querySelector('#service-choice').value=a.dataset.service));
const dialog=document.querySelector('#gallery-dialog');
const photos=[['green-truck','Lavish bucket truck set up beneath a tree'],['stump-grinding','Stump grinder at a residential property'],['rigging','A large tree limb secured with lifting straps'],['fleet','Lavish trucks working at a neighborhood property']];
document.querySelectorAll('[data-gallery]').forEach(button=>button.addEventListener('click',()=>{const [file,caption]=photos[Number(button.dataset.gallery)];document.querySelector('#gallery-image').src='assets/'+file+'.webp';document.querySelector('#gallery-image').alt=caption;document.querySelector('#gallery-caption').textContent=caption;dialog.showModal();}));
document.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.close();}});
document.querySelector('#quote-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;const data=new FormData(form);document.querySelector('#request-summary').textContent=[['Name','name'],['Phone','phone'],['Email','email'],['Service','service'],['Property','address'],['Details','message']].map(([label,name])=>label+': '+(data.get(name)||'Not provided')).join('\n');const result=document.querySelector('#form-result');result.hidden=false;result.focus({preventScroll:true});result.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});});
document.querySelector('#year').textContent=String(new Date().getFullYear());

document.querySelector('.form-submit').disabled=false;
