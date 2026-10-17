const $ = id => document.getElementById(id);
const state = { token: localStorage.getItem('kr_token') || '', user: null, outlets: [], menu: [], cart: {}, page: 'customer' };
const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n||0));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastTimer;

function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2800);}
async function api(url, options={}) {
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  if(state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(url,{...options,headers});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function showPage(name){
  state.page=name;
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  $(`${name}Page`).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  window.scrollTo({top:0,behavior:'smooth'});
}
function updateNav(){
  $('dashboardNav').classList.toggle('hidden',!state.user);
  $('kitchenNav').classList.toggle('hidden',!state.user || !['admin','sub_admin','chef'].includes(state.user.role));
}
function cartSubtotal(){return Object.entries(state.cart).reduce((sum,[id,qty])=>sum+Number(state.menu.find(p=>p.id===Number(id))?.price||0)*qty,0);}
function renderMenu(){
  $('menuGrid').innerHTML=state.menu.length?state.menu.map(p=>`<article class="product-card"><div class="product-visual ${esc((p.category||'').toLowerCase())}">${p.image_url?`<img alt="" src="${esc(p.image_url)}" style="max-width:100%;max-height:100%;object-fit:cover">`:({Snacks:'🥪',Meals:'🍛',Drinks:'🥤'}[p.category]||'🍽️')}</div><div class="product-info"><h3>${esc(p.name)}</h3><p>${esc(p.description||p.category||'Freshly prepared')}</p><div class="product-bottom"><span class="price">${money(p.price)}</span><button class="add-btn" data-add="${p.id}">＋ Add item</button></div></div></article>`).join(''):'<div class="empty-state">No available menu items for this outlet.</div>';
  renderCart();
}
function renderCart(){
  const rows=Object.entries(state.cart).filter(([,q])=>q>0);
  $('cartCount').textContent=rows.reduce((n,[,q])=>n+q,0);
  $('cartItems').innerHTML=rows.length?rows.map(([id,q])=>{const p=state.menu.find(x=>x.id===Number(id));return `<div class="cart-row"><div><strong>${esc(p?.name||'Item')}</strong><br><small>${money(p?.price||0)} each</small></div><div class="qty"><button data-qty="${id}" data-delta="-1">−</button><span>${q}</span><button data-qty="${id}" data-delta="1">+</button></div><strong>${money(Number(p?.price||0)*q)}</strong></div>`}).join(''):'Your cart is empty.';
  $('cartTotal').textContent=money(cartSubtotal()+(rows.length?5:0));
}
async function loadOutlets(){
  const data=await api('/api/outlets');state.outlets=data.outlets;
  $('outletSelect').innerHTML=state.outlets.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('');
  const params=new URLSearchParams(location.search);
  if(params.get('outlet') && state.outlets.some(o=>String(o.id)===params.get('outlet'))) $('outletSelect').value=params.get('outlet');
  document.querySelectorAll('.outlet-options').forEach(sel=>{
    const keep=sel.value;sel.innerHTML=(sel.name==='outlet_id'&&sel.closest('#staffForm')?'<option value="">All / none</option>':'')+state.outlets.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('');
    if([...sel.options].some(o=>o.value===keep))sel.value=keep;
  });
  $('reportOutlet').innerHTML='<option value="">All outlets</option>'+state.outlets.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('');
  const selected=state.outlets.find(o=>String(o.id)===$('outletSelect').value)||state.outlets[0];
  if(selected) await loadMenu(selected.id);
}
async function loadMenu(outletId){
  const data=await api(`/api/menu?outletId=${encodeURIComponent(outletId)}`);
  state.menu=data.items.map(p=>({...p,id:Number(p.id),price:Number(p.price)}));state.cart={};renderMenu();
}
$('outletSelect').addEventListener('change',()=>loadMenu($('outletSelect').value).catch(e=>toast(e.message)));
$('menuGrid').addEventListener('click',e=>{const b=e.target.closest('[data-add]');if(!b)return;const id=Number(b.dataset.add);state.cart[id]=(state.cart[id]||0)+1;renderCart();toast('Added to your order.');});
$('cartItems').addEventListener('click',e=>{const b=e.target.closest('[data-qty]');if(!b)return;const id=Number(b.dataset.qty);state.cart[id]=(state.cart[id]||0)+Number(b.dataset.delta);if(state.cart[id]<=0)delete state.cart[id];renderCart();});
$('checkoutForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=new FormData(e.currentTarget);const items=Object.entries(state.cart).map(([id,quantity])=>({id:Number(id),quantity}));
  if(!items.length)return toast('Add at least one item first.');
  const button=e.currentTarget.querySelector('button[type=submit]');button.disabled=true;
  try{
    const result=await api('/api/orders',{method:'POST',body:JSON.stringify({outletId:Number($('outletSelect').value),name:form.get('name'),phone:form.get('phone'),notes:form.get('notes'),items})});
    state.cart={};renderCart();e.currentTarget.reset();
    $('orderSuccess').classList.remove('hidden');$('orderSuccess').innerHTML=`<strong>Order placed: ${esc(result.order.orderNumber)}</strong><br>Total: ${money(result.order.total)}<br>Status: Pending kitchen acceptance.<br><small>This is a demo order; payment has not been collected.</small>`;
    $('orderSuccess').scrollIntoView({behavior:'smooth',block:'center'});toast('Order saved to MySQL.');
  }catch(err){toast(err.message);}finally{button.disabled=false;}
});

$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);$('loginError').textContent='';
  try{
    const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:f.get('email'),password:f.get('password')})});
    state.token=data.token;state.user=data.user;localStorage.setItem('kr_token',state.token);updateNav();await loadManagement();showPage('dashboard');await loadDashboard();toast('Signed in successfully.');
  }catch(err){$('loginError').textContent=err.message;}
});
$('logoutBtn').addEventListener('click',()=>{state.token='';state.user=null;localStorage.removeItem('kr_token');updateNav();showPage('customer');toast('Signed out.');});
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',async()=>{
  const page=b.dataset.page;
  if(page==='dashboard'||page==='kitchen'){
    if(!state.user){showPage('login');return;}
    showPage(page);
    try{if(page==='dashboard'){await loadManagement();await loadDashboard();}else await loadKitchen();}catch(e){toast(e.message);}
  }else showPage(page);
}));

function getRange(){
  const period=$('periodFilter').value;const now=new Date();const to=new Date(now);let from=new Date(now);
  if(period==='week')from.setDate(from.getDate()-6);
  else if(period==='month')from.setDate(from.getDate()-29);
  else if(period==='year')from.setFullYear(from.getFullYear()-1);
  else if(period==='custom'){return {from:$('fromDate').value,to:$('toDate').value};}
  return {from:from.toLocaleDateString('en-CA'),to:to.toLocaleDateString('en-CA')};
}
$('periodFilter').addEventListener('change',()=>document.querySelectorAll('.custom-date').forEach(el=>el.classList.toggle('hidden',$('periodFilter').value!=='custom')));
$('applyFilters').addEventListener('click',()=>loadDashboard().catch(e=>toast(e.message)));
$('statusFilter').addEventListener('change',()=>loadDashboard().catch(e=>toast(e.message)));
async function loadDashboard(){
  const range=getRange();if(!range.from||!range.to)return toast('Choose both dates.');
  if(range.from>range.to)return toast('From date must be before To date.');
  const params=new URLSearchParams({...range});if($('reportOutlet').value)params.set('outletId',$('reportOutlet').value);
  const status=$('statusFilter').value;if(status)params.set('status',status);
  const [summary,orders]=await Promise.all([api('/api/dashboard/summary?'+params.toString()),api('/api/orders?'+params.toString())]);
  $('statOrders').textContent=summary.summary.totalOrders||0;$('statSales').textContent=money(summary.summary.totalSales);$('statActive').textContent=summary.summary.activeOrders||0;$('statCompleted').textContent=summary.summary.completedOrders||0;
  $('ordersTable').innerHTML=orders.orders.length?orders.orders.map(o=>`<tr><td><strong>${esc(o.order_number)}</strong><br><small>#${o.id}</small></td><td>${esc(o.customer_name)}<br><small>${esc(o.customer_phone)}</small></td><td>${esc(o.outlet_name)}</td><td>${o.items.map(i=>`${i.quantity} × ${esc(i.item_name)}`).join('<br>')}</td><td><strong>${money(o.total)}</strong><br><small>${esc(o.payment_status)}</small></td><td><span class="status-pill">${esc(o.status)}</span></td><td>${new Date(o.created_at).toLocaleString()}</td></tr>`).join(''):'<tr><td colspan="7" class="empty-state">No orders found for these filters.</td></tr>';
}
async function loadManagement(){
  if(!state.user)return;
  $('welcomeText').textContent=`Signed in as ${state.user.name} · Role: ${state.user.role}`;
  document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('hidden',state.user.role!=='admin'));
  $('outletFilterWrap').classList.toggle('hidden',state.user.role!=='admin');
  const [outlets,menu]=await Promise.all([api('/api/admin/outlets'),api('/api/admin/menu')]);
  state.outlets=outlets.outlets;
  $('outletSelect').innerHTML=state.outlets.filter(o=>o.is_active).map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('');
  document.querySelectorAll('.outlet-options').forEach(sel=>{const isStaff=sel.closest('#staffForm');sel.innerHTML=(isStaff?'<option value="">All / none</option>':'')+state.outlets.filter(o=>o.is_active).map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('');});
  $('reportOutlet').innerHTML='<option value="">All outlets</option>'+state.outlets.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('');
  $('menuAdminList').innerHTML=menu.items.map(m=>`<div class="compact-row"><div><strong>${esc(m.name)}</strong><small>${esc(m.category||'Uncategorized')} · ${money(m.price)} · ${m.is_available?'Available':'Unavailable'}</small></div><button data-delete-menu="${m.id}">Deactivate</button></div>`).join('')||'<p class="empty-state">No menu items.</p>';
  if(state.user.role==='admin'){
    $('outletAdminList').innerHTML=state.outlets.map(o=>`<div class="compact-row"><div><strong>${esc(o.name)} (${esc(o.code)})</strong><small>${esc(o.address||'')} · ${o.is_active?'Active':'Inactive'}</small></div><button data-delete-outlet="${o.id}">Deactivate</button></div>`).join('');
    const users=await api('/api/admin/users');
    $('staffAdminList').innerHTML=users.users.map(u=>`<div class="compact-row"><div><strong>${esc(u.name)}</strong><small>${esc(u.email)} · ${esc(u.role)} · ${u.is_active?'Active':'Inactive'}</small></div><button data-delete-user="${u.id}" ${Number(u.id)===Number(state.user.id)?'disabled':''}>Deactivate</button></div>`).join('');
  }
}
$('menuForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);
  try{await api('/api/admin/menu',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});e.currentTarget.reset();await loadManagement();await loadDashboard();toast('Menu item added.');}catch(err){toast(err.message);}
});
$('menuAdminList').addEventListener('click',async e=>{const b=e.target.closest('[data-delete-menu]');if(!b)return;if(!confirm('Deactivate this menu item?'))return;try{await api('/api/admin/menu/'+b.dataset.deleteMenu,{method:'DELETE'});await loadManagement();toast('Menu item deactivated.');}catch(err){toast(err.message);}});
$('outletForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/admin/outlets',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});e.currentTarget.reset();await loadManagement();toast('Outlet added.');}catch(err){toast(err.message);}});
$('outletAdminList').addEventListener('click',async e=>{const b=e.target.closest('[data-delete-outlet]');if(!b||!confirm('Deactivate this outlet?'))return;try{const id=b.dataset.deleteOutlet;const outlet=state.outlets.find(o=>String(o.id)===id);await api('/api/admin/outlets/'+id,{method:'PUT',body:JSON.stringify({...outlet,is_active:false})});await loadManagement();toast('Outlet deactivated.');}catch(err){toast(err.message);}});
$('staffForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const payload=Object.fromEntries(f);if(!payload.outlet_id)delete payload.outlet_id;try{await api('/api/admin/users',{method:'POST',body:JSON.stringify(payload)});e.currentTarget.reset();await loadManagement();toast('Staff account created.');}catch(err){toast(err.message);}});
$('staffAdminList').addEventListener('click',async e=>{const b=e.target.closest('[data-delete-user]');if(!b||b.disabled||!confirm('Deactivate this staff account?'))return;try{await api('/api/admin/users/'+b.dataset.deleteUser,{method:'DELETE'});await loadManagement();toast('Staff account deactivated.');}catch(err){toast(err.message);}});

async function loadKitchen(){
  const data=await api('/api/kitchen/orders');
  $('kitchenGrid').innerHTML=data.orders.length?data.orders.map(o=>{
    const next={pending:['accepted','Accept order'],accepted:['preparing','Start preparing'],preparing:['ready','Mark ready'],ready:['completed','Complete order']}[o.status];
    return `<article class="kitchen-card"><span class="eyebrow">${esc(o.outlet_name)}</span><h3>${esc(o.order_number)}</h3><p>${esc(o.customer_name)} · ${new Date(o.created_at).toLocaleTimeString()}</p><span class="status-pill">${esc(o.status)}</span><ul>${o.items.map(i=>`<li>${i.quantity} × ${esc(i.item_name)}</li>`).join('')}</ul><p><strong>${money(o.total)}</strong></p>${next?`<button class="btn btn-primary" data-kitchen-status="${next[0]}" data-order-id="${o.id}">${next[1]}</button>`:''}</article>`;
  }).join(''):'<div class="empty-state panel">No active kitchen orders right now.</div>';
}
$('kitchenGrid').addEventListener('click',async e=>{const b=e.target.closest('[data-kitchen-status]');if(!b)return;b.disabled=true;try{await api(`/api/kitchen/orders/${b.dataset.orderId}/status`,{method:'PATCH',body:JSON.stringify({status:b.dataset.kitchenStatus})});await loadKitchen();toast('Kitchen order status updated.');}catch(err){toast(err.message);}finally{b.disabled=false;}});
$('refreshKitchen').addEventListener('click',()=>loadKitchen().catch(e=>toast(e.message)));

async function boot(){
  try{await loadOutlets();}catch(e){$('menuGrid').innerHTML=`<div class="empty-state">Cannot load menu: ${esc(e.message)}. Make sure MySQL is running and the server is started.</div>`;}
  if(state.token){
    try{const data=await api('/api/auth/me');state.user=data.user;updateNav();await loadManagement();showPage('dashboard');await loadDashboard();}
    catch(_){state.token='';state.user=null;localStorage.removeItem('kr_token');updateNav();showPage('customer');}
  }
}
boot();
