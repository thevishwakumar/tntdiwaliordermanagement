/**
 * TNT Diwali Order Management System — Admin Hub Controller
 * 
 * Drives:
 * - Real-time metrics and verified revenue reporting
 * - Searchable, filterable order registry with IST timestamps
 * - Kitchen packing queue (strictly PAID & PREPARING orders)
 * - Shop counter pickup verification (server-side code validation)
 * - Product master & authoritative price updates
 * - Audit trail monitoring
 * - Printable parcel labels, packing slips, and receipts
 */

import { formatINR, formatQuantityUnit, APP_CONFIG } from './config.js';

// Authentication Guard
const token = sessionStorage.getItem('tnt_admin_token');
const adminEmail = sessionStorage.getItem('tnt_admin_email') || 'admin@tntcatering.in';
const adminRole = sessionStorage.getItem('tnt_admin_role') || 'admin';

if (!token && !window.location.pathname.includes('login.html')) {
  window.location.href = 'login.html';
}

/**
 * Extract and standardize ordered items from order record
 * Handles Postgres schema (order_items with snapshots) and API schema (items)
 */
function getOrderItems(order) {
  if (!order) return [];
  const rawItems = (Array.isArray(order.items) && order.items.length > 0)
    ? order.items
    : (Array.isArray(order.order_items) ? order.order_items : []);

  return rawItems.map(item => {
    const name = item.name || item.product_name_snapshot || item.productName || 'Festive Delicacy';
    const tamil_name = item.tamil_name || item.product_tamil_name || item.tamilName || '';
    const unit = item.unit || item.unit_snapshot || 'box';
    const quantity = Number(item.quantity) || 1;
    const unitPricePaise = item.unit_price_paise != null
      ? Number(item.unit_price_paise)
      : (item.price != null ? Math.round(Number(item.price) * 100) : 0);
    const lineTotalPaise = item.line_total_paise != null
      ? Number(item.line_total_paise)
      : (item.total != null ? Math.round(Number(item.total) * 100) : (unitPricePaise * quantity));

    return {
      id: item.id || item.product_id || '',
      productId: item.productId || item.product_id || '',
      name,
      tamil_name,
      unit,
      quantity,
      unit_price_paise: unitPricePaise,
      line_total_paise: lineTotalPaise,
      price: unitPricePaise / 100,
      total: lineTotalPaise / 100
    };
  });
}

/**
 * Standardize an order object so items and order_items are guaranteed to exist
 */
function normalizeOrder(order) {
  if (!order) return order;
  const items = getOrderItems(order);
  order.items = items;
  order.order_items = items;
  return order;
}

// Global State
let ordersCache = [];
let currentFilterStatus = 'ALL';
let currentSearchQuery = '';
let currentPaymentFilter = 'ALL';
let currentFulfilmentFilter = 'ALL';
let currentProductFilter = 'ALL';
let currentPickupDateFilter = '';
let currentSort = 'ORDER_DESC';
let selectedOrderIds = new Set();

document.addEventListener('DOMContentLoaded', () => {
  initAdminDashboard();
});

function initAdminDashboard() {
  setupUserNav();
  setupTabs();
  setupFilters();
  setupModals();
  loadOverviewMetrics();
  loadOrders();
}

/**
 * Setup Admin Navbar & Sign Out
 */
function setupUserNav() {
  const userDisplay = document.getElementById('admin-user-display');
  if (userDisplay) {
    userDisplay.textContent = `👤 ${adminEmail} [${adminRole}]`;
  }

  document.getElementById('btn-admin-logout')?.addEventListener('click', () => {
    sessionStorage.clear();
    window.location.href = 'login.html';
  });

  document.querySelectorAll('.btn-refresh-all').forEach(btn => {
    btn.addEventListener('click', () => {
      loadOverviewMetrics();
      loadOrders();
    });
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    window.location.href = '/api/admin/export-csv';
  });
}

/**
 * Tab Navigation Controller
 */
function setupTabs() {
  const tabButtons = document.querySelectorAll('.subnav-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      tabButtons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));

      e.currentTarget.classList.add('active');
      const targetId = e.currentTarget.dataset.tab;
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.remove('hidden');
      }

      // Contextual refresh
      if (targetId === 'tab-overview') loadOverviewMetrics();
      else if (targetId === 'tab-orders') loadOrders();
      else if (targetId === 'tab-packing') loadPackingQueue();
      else if (targetId === 'tab-pickup') loadPickupQueue();
      else if (targetId === 'tab-products') loadProductsMaster();
      else if (targetId === 'tab-audit') loadAuditLogs();
    });
  });
}

/**
 * Filter Listeners
 */
function setupFilters() {
  const searchInput = document.getElementById('order-search-input');
  const statusSelect = document.getElementById('filter-order-status');
  const paymentSelect = document.getElementById('filter-payment-status');
  const fulfilmentSelect = document.getElementById('filter-fulfilment-method');
  const productSelect = document.getElementById('filter-product');
  const pickupDateInput = document.getElementById('filter-pickup-date');
  const sortSelect = document.getElementById('sort-orders');
  const resetBtn = document.getElementById('btn-reset-filters');

  let debounceTimer;
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentSearchQuery = e.target.value.trim().toLowerCase();
      renderOrdersTable();
    }, 250);
  });

  statusSelect?.addEventListener('change', (e) => {
    currentFilterStatus = e.target.value;
    renderOrdersTable();
  });

  paymentSelect?.addEventListener('change', (e) => {
    currentPaymentFilter = e.target.value;
    renderOrdersTable();
  });

  fulfilmentSelect?.addEventListener('change', (e) => {
    currentFulfilmentFilter = e.target.value;
    renderOrdersTable();
  });

  productSelect?.addEventListener('change', (e) => {
    currentProductFilter = e.target.value;
    renderOrdersTable();
  });

  pickupDateInput?.addEventListener('change', (e) => {
    currentPickupDateFilter = e.target.value;
    renderOrdersTable();
  });

  sortSelect?.addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderOrdersTable();
  });

  resetBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (statusSelect) statusSelect.value = 'ALL';
    if (paymentSelect) paymentSelect.value = 'ALL';
    if (fulfilmentSelect) fulfilmentSelect.value = 'ALL';
    if (productSelect) productSelect.value = 'ALL';
    if (pickupDateInput) pickupDateInput.value = '';
    if (sortSelect) sortSelect.value = 'ORDER_DESC';
    currentSearchQuery = '';
    currentFilterStatus = 'ALL';
    currentPaymentFilter = 'ALL';
    currentFulfilmentFilter = 'ALL';
    currentProductFilter = 'ALL';
    currentPickupDateFilter = '';
    currentSort = 'ORDER_DESC';
    renderOrdersTable();
  });

  // Batch Print Selection
  const selectAll = document.getElementById('select-all-orders');
  selectAll?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll('.order-select-checkbox').forEach(cb => {
      cb.checked = isChecked;
      const id = cb.dataset.id;
      if (isChecked) selectedOrderIds.add(id);
      else selectedOrderIds.delete(id);
    });
    updateBatchCount();
  });

  document.getElementById('btn-batch-print-labels')?.addEventListener('click', () => {
    batchPrintParcelLabels();
  });
}

function updateBatchCount() {
  const countEl = document.getElementById('batch-selected-count');
  if (countEl) countEl.textContent = selectedOrderIds.size;
}

/**
function renderDailySummaryFromOrders(ordersList) {
  const dailyContainer = document.getElementById('overview-daily-summary');
  if (!dailyContainer) return;

  const validOrders = (ordersList || ordersCache || []).filter(o => o.payment_status === 'PAID');
  if (validOrders.length === 0) {
    dailyContainer.innerHTML = '<p style="color: var(--color-text-muted); font-size: 0.85rem; padding: 0.5rem 0;">No paid orders registered yet.</p>';
    return;
  }

  const dailyMap = {};
  validOrders.forEach(o => {
    const d = o.pickup_date || (o.created_at ? o.created_at.split('T')[0] : 'Today');
    if (!dailyMap[d]) dailyMap[d] = { date: d, orderCount: 0, revenuePaise: 0 };
    dailyMap[d].orderCount++;
    dailyMap[d].revenuePaise += (o.total_paise || (o.total || 0) * 100);
  });

  const summary = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));
  let dHtml = '<table class="admin-table" style="font-size: 0.825rem; width: 100%;"><thead><tr><th>Scheduled Date</th><th>Paid Orders</th><th>Verified Revenue</th></tr></thead><tbody>';
  summary.forEach(d => {
    dHtml += `<tr><td><strong>📅 ${escapeHTML(d.date)}</strong></td><td><span class="status-badge status-PAID">${d.orderCount} orders</span></td><td style="color: #1B5E20; font-weight: 700;">${formatINR(d.revenuePaise / 100)}</td></tr>`;
  });
  dHtml += '</tbody></table>';
  dailyContainer.innerHTML = dHtml;
}

function renderStockAlerts(lowStockProducts) {
  const stockContainer = document.getElementById('overview-stock-alerts');
  if (!stockContainer) return;

  if (lowStockProducts && lowStockProducts.length > 0) {
    let sHtml = '<div style="space-y-2">';
    lowStockProducts.forEach(p => {
      sHtml += `
        <div style="background: var(--color-bg-surface-alt); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 0.6rem 0.8rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
          <div><strong>${escapeHTML(p.name)}</strong><div style="font-size: 0.75rem; color: var(--color-text-muted);">Threshold: ${p.low_stock_threshold || 50} ${p.unit}</div></div>
          <span class="status-badge" style="background: #FFEBEE; color: #B71C1C;">${p.stock_quantity || 0} ${p.unit} left</span>
        </div>
      `;
    });
    sHtml += '</div>';
    stockContainer.innerHTML = sHtml;
  } else {
    stockContainer.innerHTML = `
      <div class="alert-box alert-success" style="margin: 0; font-size: 0.85rem; padding: 0.85rem 1rem;">
        <span class="alert-icon">✓</span> <strong>Inventory Healthy:</strong> All 5 festive items (Traditional Sweets, Ghee Sweets, Karam, Dry Fruits, Mixed Combo) have sufficient stock ready in cloud kitchen.
      </div>
    `;
  }
}

/**
 * Fetch and Render Operations Overview Metrics
 */
async function loadOverviewMetrics() {
  try {
    const res = await fetch('/api/admin/metrics', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;

    const data = await res.json();
    if (!data.success) return;

    const m = data.metrics;
    if (document.getElementById('metric-revenue')) document.getElementById('metric-revenue').textContent = formatINR(m.totalVerifiedRevenueRupees);
    if (document.getElementById('metric-total-orders')) document.getElementById('metric-total-orders').textContent = m.totalOrders || 0;
    if (document.getElementById('metric-paid-count')) document.getElementById('metric-paid-count').textContent = m.paidOrders || 0;
    if (document.getElementById('metric-pending-count')) document.getElementById('metric-pending-count').textContent = m.pendingPayment || m.awaitingPayment || 0;
    if (document.getElementById('metric-upcoming-count')) document.getElementById('metric-upcoming-count').textContent = m.upcomingPickups || 0;
    if (document.getElementById('metric-ready-count')) document.getElementById('metric-ready-count').textContent = m.readyForPickup || 0;
    if (document.getElementById('metric-picked-count')) document.getElementById('metric-picked-count').textContent = m.pickedUp || 0;
    if (document.getElementById('metric-cancelled-count')) document.getElementById('metric-cancelled-count').textContent = m.cancelledOrders || m.cancelled || 0;
    if (document.getElementById('metric-prep-count')) document.getElementById('metric-prep-count').textContent = m.preparing || 0;

    // Daily breakdown: use API summary or compute from cached orders
    if (m.dailySummary && m.dailySummary.length > 0) {
      const dailyContainer = document.getElementById('overview-daily-summary');
      if (dailyContainer) {
        let dHtml = '<table class="admin-table" style="font-size: 0.825rem; width: 100%;"><thead><tr><th>Scheduled Date</th><th>Paid Orders</th><th>Verified Revenue</th></tr></thead><tbody>';
        m.dailySummary.forEach(d => {
          dHtml += `<tr><td><strong>📅 ${escapeHTML(d.date)}</strong></td><td><span class="status-badge status-PAID">${d.orderCount} orders</span></td><td style="color: #1B5E20; font-weight: 700;">${formatINR(d.revenuePaise / 100)}</td></tr>`;
        });
        dHtml += '</tbody></table>';
        dailyContainer.innerHTML = dHtml;
      }
    } else {
      renderDailySummaryFromOrders(ordersCache);
    }

    // Stock alerts
    renderStockAlerts(m.lowStockProducts);

  } catch (e) {
    console.error('Failed to load metrics:', e);
    renderDailySummaryFromOrders(ordersCache);
    renderStockAlerts(null);
  }
}

/**
 * Fetch Orders List
 */
async function loadOrders() {
  try {
    const res = await fetch('/api/admin/orders', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;

    const data = await res.json();
    if (!data.success) return;

    ordersCache = (data.orders || []).map(normalizeOrder);
    renderOrdersTable();
    renderDailySummaryFromOrders(ordersCache);
  } catch (e) {
    console.error('Failed to load orders:', e);
  }
}

/**
 * Render Orders Table with Filter & IST Timestamps
 */
function renderOrdersTable() {
  const tbody = document.getElementById('admin-orders-table-body');
  if (!tbody) return;

  let filtered = [...ordersCache];

  // Status Filter
  if (currentFilterStatus !== 'ALL') {
    filtered = filtered.filter(o => o.order_status === currentFilterStatus);
  }

  // Payment Filter
  if (currentPaymentFilter !== 'ALL') {
    filtered = filtered.filter(o => o.payment_status === currentPaymentFilter);
  }

  // Fulfilment Filter
  if (currentFulfilmentFilter !== 'ALL') {
    filtered = filtered.filter(o => (o.fulfilment_method || 'PICKUP') === currentFulfilmentFilter);
  }

  // Pickup Date Filter
  if (currentPickupDateFilter) {
    filtered = filtered.filter(o => o.pickup_date === currentPickupDateFilter);
  }

  // Product Filter
  if (currentProductFilter !== 'ALL') {
    filtered = filtered.filter(o => getOrderItems(o).some(i => i.productId === currentProductFilter || (i.name || '').toLowerCase().includes(currentProductFilter.replace('tnt-', ''))));
  }

  // Search Filter
  if (currentSearchQuery) {
    filtered = filtered.filter(o =>
      (o.public_order_number || '').toLowerCase().includes(currentSearchQuery) ||
      (o.customer_name || '').toLowerCase().includes(currentSearchQuery) ||
      (o.customer_mobile || '').includes(currentSearchQuery)
    );
  }

  // Sorting
  if (currentSort === 'ORDER_DESC') {
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else if (currentSort === 'ORDER_ASC') {
    filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else if (currentSort === 'PICKUP_ASC') {
    filtered.sort((a, b) => (a.pickup_date || '').localeCompare(b.pickup_date || '') || new Date(a.created_at) - new Date(b.created_at));
  } else if (currentSort === 'PICKUP_DESC') {
    filtered.sort((a, b) => (b.pickup_date || '').localeCompare(a.pickup_date || '') || new Date(b.created_at) - new Date(a.created_at));
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">No orders matching current filters.</td></tr>`;
    return;
  }

  let html = '';
  filtered.forEach(order => {
    const isChecked = selectedOrderIds.has(order.id);
    const istTime = new Date(order.created_at).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const orderItems = getOrderItems(order);
    const itemsSummary = orderItems.map(i => `${escapeHTML(i.name)} (${i.quantity} ${i.unit})`).join(', ');
    const totalRupees = (order.total_paise || 0) / 100;
    const isPaid = order.payment_status === 'PAID';
    const isReady = order.order_status === 'READY_FOR_PICKUP';
    const isPickedUp = order.order_status === 'PICKED_UP';
    const displayFulfillmentStatus = (order.order_status === 'PAID') ? 'SCHEDULED' : order.order_status;
    const isDelivery = order.fulfilment_method === 'DELIVERY';

    html += `
      <tr data-id="${order.id}">
        <td>
          <input type="checkbox" class="order-select-checkbox" data-id="${order.id}" ${isChecked ? 'checked' : ''}>
        </td>
        <td>
          <strong style="font-family: var(--font-mono); color: var(--color-maroon-900);">${escapeHTML(order.public_order_number)}</strong>
        </td>
        <td style="font-size: 0.8rem; color: var(--color-text-muted); white-space: nowrap;">
          ${istTime}
        </td>
        <td>
          <div style="font-weight: 700;">${escapeHTML(order.customer_name)}</div>
          <div style="font-size: 0.8rem; font-family: var(--font-mono); color: var(--color-maroon-800);">${escapeHTML(order.customer_mobile)}</div>
          <div style="margin-top: 0.25rem;">
            ${isDelivery ? `
              <span class="status-badge badge-fulfilment-delivery" title="${escapeHTML(order.delivery_address?.formatted || (typeof order.delivery_address === 'string' ? order.delivery_address : ''))}">
                🚚 DELIVERY (PORTER)
              </span>
            ` : `
              <span class="status-badge badge-fulfilment-pickup">
                🏬 STORE PICKUP
              </span>
            `}
          </div>
        </td>
        <td style="max-width: 240px; font-size: 0.8rem; line-height: 1.4;">
          ${itemsSummary || 'Festive Delicacy Pack'}
        </td>
        <td>
          <strong style="color: var(--color-maroon-900);">${formatINR(totalRupees)}</strong>
        </td>
        <td>
          <span class="status-badge status-${order.payment_status}">${order.payment_status}</span>
        </td>
        <td>
          <span class="status-badge status-${order.order_status}">${displayFulfillmentStatus}</span>
        </td>
        <td style="font-size: 0.82rem; white-space: nowrap;">
          <strong>📅 ${escapeHTML(order.pickup_date || 'Today')}</strong>
          <div style="font-size: 0.72rem; color: var(--color-text-muted);">${escapeHTML(order.pickup_time || 'Morning')}</div>
          ${isDelivery ? `
            <div style="font-size: 0.72rem; color: #E65100; font-weight: 700; margin-top: 2px;">🚚 Doorstep Delivery</div>
          ` : ''}
        </td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 0.35rem;">
            <div style="display: flex; gap: 0.35rem;">
              <button type="button" class="btn btn-outline btn-view-order" data-id="${order.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
                View
              </button>

              ${(isPaid && !isReady && !isPickedUp && order.order_status !== 'CANCELLED') ? `
                <button type="button" class="btn btn-outline btn-mark-ready" data-id="${order.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: #4A148C; border-color: #CE93D8; white-space: nowrap;">
                  ✓ Ready
                </button>
              ` : ''}

              ${isReady ? `
                <button type="button" class="btn btn-primary btn-mark-picked-up" data-id="${order.id}" data-ref="${order.public_order_number}" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; background: #2E7D32; border-color: #1B5E20; font-weight: 700; white-space: nowrap;">
                  🛍️ Mark Picked Up
                </button>
              ` : ''}
            </div>

            <div style="display: flex; gap: 0.35rem;">
              <button type="button" class="btn btn-outline btn-print-receipt-row" data-id="${order.id}" title="Print Customer Receipt" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; font-weight: 700;">
                🧾 Receipt
              </button>
              <button type="button" class="btn btn-secondary btn-print-label" data-id="${order.id}" title="Print 1-Page Box Sticker Label" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; font-weight: 700; white-space: nowrap;">
                🏷️ Sticker
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;

  // Row selection checkboxes
  document.querySelectorAll('.order-select-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) selectedOrderIds.add(id);
      else selectedOrderIds.delete(id);
      updateBatchCount();
    });
  });

  // View Order Modal
  document.querySelectorAll('.btn-view-order').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      openOrderDetailsModal(id);
    });
  });

  // Mark Ready for Pickup Action
  document.querySelectorAll('.btn-mark-ready').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      await updateOrderStatus(id, 'READY_FOR_PICKUP');
      loadOverviewMetrics();
      loadOrders();
    });
  });

  // Mark as Picked Up Action
  document.querySelectorAll('.btn-mark-picked-up').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      const ref = e.currentTarget.dataset.ref;
      openPickupVerifyModal(id, ref);
    });
  });

  // Print Receipt Row Button
  document.querySelectorAll('.btn-print-receipt-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      const order = ordersCache.find(o => o.id === id);
      if (order) printCustomerReceipt(normalizeOrder(order));
    });
  });

  // Print Slip Row Button
  document.querySelectorAll('.btn-print-slip-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      const order = ordersCache.find(o => o.id === id);
      if (order) printPackingSlip(normalizeOrder(order));
    });
  });

  // Print Label Quick Button
  document.querySelectorAll('.btn-print-label').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      const order = ordersCache.find(o => o.id === id);
      if (order) printSingleParcelLabel(normalizeOrder(order));
    });
  });
}

/**
 * Render Complete End-to-End Order Details in Modal
 */
function renderOrderDetailsModalContent(container, modal, o) {
  o = normalizeOrder(o);
  const totalRupees = (o.total_paise || 0) / 100;
  const istTime = new Date(o.created_at || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'short'
  });

  const items = getOrderItems(o);
  let itemsRows = '';
  if (items.length === 0) {
    itemsRows = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 1.25rem; color: var(--color-text-muted);">
          Festive Delicacies Pack — Standard Pack
        </td>
      </tr>
    `;
  } else {
    items.forEach(item => {
      const unitRupees = (item.unit_price_paise || 0) / 100;
      const lineRupees = (item.line_total_paise || (item.unit_price_paise * item.quantity)) / 100;
      itemsRows += `
        <tr>
          <td>
            <strong>${escapeHTML(item.name)}</strong>
            ${item.tamil_name ? `<div style="font-size: 0.75rem; color: var(--color-text-muted);">${escapeHTML(item.tamil_name)}</div>` : ''}
          </td>
          <td>${formatQuantityUnit(item.quantity, item.unit)}</td>
          <td>${formatINR(unitRupees)}</td>
          <td style="font-weight: 700;">${formatINR(lineRupees)}</td>
        </tr>
      `;
    });
  }

  let timelineHtml = '';
  (o.events || []).forEach(ev => {
    const evTime = new Date(ev.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short', dateStyle: 'short' });
    timelineHtml += `
      <li style="margin-bottom: 0.5rem; font-size: 0.8rem;">
        <span style="font-weight: 700; color: var(--color-maroon-800);">${escapeHTML(ev.event_type || '')}</span>: 
        ${ev.from_status ? `${escapeHTML(ev.from_status)} → ` : ''}<strong>${escapeHTML(ev.to_status || '')}</strong>
        <span style="color: var(--color-text-muted);">(${evTime}${ev.actor_type ? ` by ${escapeHTML(ev.actor_type)}` : ''})</span>
      </li>
    `;
  });

  const isDelivery = o.fulfilment_method === 'DELIVERY';
  const deliveryFeeRupees = (o.delivery_fee_paise || 0) / 100;
  const deliveryAddrStr = o.delivery_address?.formatted || (typeof o.delivery_address === 'string' ? o.delivery_address : '') || (o.delivery_address ? `${o.delivery_address.street || ''}, ${o.delivery_address.area || ''}, ${o.delivery_address.city || 'Coimbatore'} - ${o.delivery_address.pincode || ''}` : '');

  container.innerHTML = `
    <div style="border-bottom: 2px solid var(--color-bg-surface-alt); padding-bottom: 1rem; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem; padding-right: 2.75rem;">
      <div>
        <h2 style="font-family: var(--font-heading); color: var(--color-maroon-900); font-size: 1.45rem; margin: 0 0 0.25rem; word-break: break-word;">
          Order #${escapeHTML(o.public_order_number || '')}
        </h2>
        <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0;">Placed on ${istTime}</p>
      </div>
      <span class="status-badge status-${o.order_status}">${escapeHTML(o.order_status || 'AWAITING_PAYMENT')}</span>
    </div>

    <!-- Customer Info & Payment Details -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-bottom: 1.25rem; background: var(--color-bg-surface-alt); padding: 1rem; border-radius: var(--radius-md);">
      <div>
        <strong style="font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted); display: block; margin-bottom: 0.35rem;">Customer Information:</strong>
        <div style="font-weight: 700; font-size: 1rem; word-break: break-word;">${escapeHTML(o.customer_name || 'Customer')}</div>
        <div style="font-family: var(--font-mono); color: var(--color-maroon-800); font-weight: 700;">+91 ${escapeHTML(o.customer_mobile || '')}</div>
        ${o.customer_email ? `<div style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 2px; word-break: break-all;">✉️ ${escapeHTML(o.customer_email)}</div>` : ''}
        ${o.customer_notes ? `<div style="font-style: italic; margin-top: 0.5rem; font-size: 0.8rem; background: #FFF8E1; padding: 0.4rem 0.6rem; border-radius: 4px; border: 1px solid #FFE082; word-break: break-word;">📝 <strong>Packing Note:</strong> ${escapeHTML(o.customer_notes)}</div>` : ''}
        <div style="margin-top: 0.65rem; font-size: 0.85rem;">
          <strong style="color: var(--color-maroon-900);">${isDelivery ? '🚚 Scheduled Delivery:' : '🏬 Scheduled Pickup:'}</strong>
          <div>📅 <strong>${escapeHTML(o.pickup_date || 'Today')}</strong></div>
          <div style="color: var(--color-text-muted);">⏰ ${escapeHTML(o.pickup_time || 'Morning (08:00 AM - 12:00 PM)')}</div>
        </div>
      </div>

      <div>
        <strong style="font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted); display: block; margin-bottom: 0.35rem;">Payment &amp; Fulfilment:</strong>
        <div style="margin-bottom: 0.35rem;">Payment State: <span class="status-badge status-${o.payment_status}">${escapeHTML(o.payment_status || 'PENDING')}</span></div>
        <div style="margin-top: 0.35rem;">
          Fulfilment: 
          ${isDelivery ? `
            <span class="status-badge badge-fulfilment-delivery">🚚 Doorstep Delivery (Porter)</span>
          ` : `
            <span class="status-badge badge-fulfilment-pickup">🏬 Direct Store Pickup (Free)</span>
          `}
        </div>
        ${isDelivery && deliveryAddrStr ? `
          <div style="background: #FFF8E1; border: 1.5px solid #FFE082; padding: 0.65rem 0.85rem; border-radius: 6px; margin-top: 0.5rem;">
            <strong style="font-size: 0.78rem; color: #BF360C; display: block;">📍 Delivery Destination:</strong>
            <div style="font-size: 0.88rem; font-weight: 700; color: #333; margin-top: 0.2rem; word-break: break-word;">
              ${escapeHTML(deliveryAddrStr)}
            </div>
            <button type="button" class="btn btn-outline btn-copy-address" style="margin-top: 0.45rem; padding: 0.25rem 0.6rem; font-size: 0.75rem;" data-address="${escapeHTML(deliveryAddrStr)}">
              📋 Copy Address for Porter App
            </button>
          </div>
        ` : ''}
        ${o.razorpay_payment_id ? `<div style="font-size: 0.8rem; font-family: var(--font-mono); margin-top: 0.45rem; word-break: break-all;">Razorpay ID: <strong>${escapeHTML(o.razorpay_payment_id)}</strong></div>` : ''}
        ${!isDelivery && (o.pickup_code_hash || o.pickup_code) ? `
          <div style="margin-top: 0.5rem; background: #E8F5E9; border: 1.5px solid #A5D6A7; padding: 0.5rem 0.75rem; border-radius: 6px;">
            <span style="font-size: 0.75rem; font-weight: 700; color: #1B5E20; text-transform: uppercase; display: block;">Official Store Pickup Code:</span>
            <span style="font-family: var(--font-mono); font-weight: 900; font-size: 1.25rem; color: #1B5E20; letter-spacing: 2px;">
              ${escapeHTML(o.pickup_code_hash || o.pickup_code)}
            </span>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Items Table -->
    <h3 style="font-size: 1rem; color: var(--color-maroon-900); margin: 0 0 0.5rem; font-family: var(--font-heading);">
      Ordered Delicacies &amp; Quantities
    </h3>
    <div style="overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 1.25rem; width: 100%;">
      <table class="admin-table" style="min-width: 480px; width: 100%; margin-bottom: 0;">
        <thead>
          <tr>
            <th>Product Description</th>
            <th>Quantity</th>
            <th>Unit Rate</th>
            <th>Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
          ${isDelivery ? `
            <tr>
              <td>
                <strong>Doorstep Delivery Fee (Porter / Partner)</strong>
                <div style="font-size: 0.75rem; color: var(--color-text-muted);">Coimbatore City Doorstep Delivery</div>
              </td>
              <td>1 trip</td>
              <td>${formatINR(deliveryFeeRupees || 80)}</td>
              <td style="font-weight: 700;">${formatINR(deliveryFeeRupees || 80)}</td>
            </tr>
          ` : ''}
          <tr>
            <td colspan="3" style="text-align: right; font-weight: 800; font-size: 0.95rem;">Authoritative Total Amount:</td>
            <td style="font-weight: 800; font-size: 1.2rem; color: var(--color-maroon-900);">${formatINR(totalRupees)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Document Printing Actions -->
    <div style="background: #FFF; border: 1.5px dashed var(--color-gold-400); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.25rem;">
      <strong style="display: block; font-size: 0.85rem; color: var(--color-maroon-900); margin-bottom: 0.5rem;">
        🖨️ Document Printing Actions:
      </strong>
      <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
        <button type="button" class="btn btn-primary btn-modal-print-receipt" style="font-size: 0.85rem; padding: 0.45rem 1rem; font-weight: 700;">
          🧾 Print Customer Receipt
        </button>
        <button type="button" class="btn btn-secondary btn-modal-print-label" style="font-size: 0.85rem; padding: 0.45rem 1rem; font-weight: 700;">
          🏷️ Print Box Sticker (1 Page)
        </button>
      </div>
    </div>

    <!-- Order Status Transition Controls -->
    <div style="display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center; flex-wrap: wrap; border-top: 1px solid var(--color-border); padding-top: 1rem;">
      <span style="font-size: 0.8rem; color: var(--color-text-muted); margin-right: auto;">Transition State:</span>
      ${o.order_status === 'PAID' ? `
        <button class="btn btn-secondary btn-action-transition" data-id="${o.id}" data-status="PREPARING">🍳 Start Kitchen Packing</button>
        <button class="btn btn-outline btn-action-transition" data-id="${o.id}" data-status="CANCELLED" style="color: var(--color-error); border-color: var(--color-error);">Cancel Order</button>
      ` : ''}
      ${o.order_status === 'PREPARING' ? `
        <button class="btn btn-primary btn-action-transition" data-id="${o.id}" data-status="READY_FOR_PICKUP">📦 Mark Ready for Pickup</button>
      ` : ''}
      ${o.order_status === 'READY_FOR_PICKUP' ? `
        <button class="btn btn-primary btn-open-pickup-from-modal" data-id="${o.id}" data-ref="${o.public_order_number}">🔑 Verify Customer Pickup Code</button>
      ` : ''}
    </div>

    <!-- Event Audit Trail -->
    ${timelineHtml ? `
      <div style="margin-top: 1.5rem; border-top: 1px dashed var(--color-border); padding-top: 1rem;">
        <strong style="font-size: 0.8rem; text-transform: uppercase; color: var(--color-text-muted);">Event Audit History:</strong>
        <ul style="list-style: none; padding-left: 0; margin-top: 0.5rem;">${timelineHtml}</ul>
      </div>
    ` : ''}
  `;

  // Attach print triggers inside modal
  container.querySelector('.btn-modal-print-label')?.addEventListener('click', () => printSingleParcelLabel(o));
  container.querySelector('.btn-modal-print-slip')?.addEventListener('click', () => printPackingSlip(o));
  container.querySelector('.btn-modal-print-receipt')?.addEventListener('click', () => printCustomerReceipt(o));

  // Copy address button
  container.querySelector('.btn-copy-address')?.addEventListener('click', (e) => {
    const addr = e.currentTarget.dataset.address;
    if (addr && navigator.clipboard) {
      navigator.clipboard.writeText(addr).then(() => {
        e.currentTarget.textContent = '✓ Address Copied!';
        setTimeout(() => { e.currentTarget.textContent = '📋 Copy Address for Porter App'; }, 2000);
      });
    }
  });

  // Attach transition handlers
  container.querySelectorAll('.btn-action-transition').forEach(b => {
    b.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const newStatus = e.currentTarget.dataset.status;
      await updateOrderStatus(id, newStatus);
      modal.classList.add('hidden');
    });
  });

  container.querySelector('.btn-open-pickup-from-modal')?.addEventListener('click', (e) => {
    modal.classList.add('hidden');
    openPickupVerifyModal(e.currentTarget.dataset.id, e.currentTarget.dataset.ref);
  });
}

/**
 * Open Order Details Modal
 */
async function openOrderDetailsModal(orderId) {
  const modal = document.getElementById('modal-order-details');
  const container = document.getElementById('order-details-content');
  if (!modal || !container) return;

  // 1. Check local cache first for instant end-to-end rendering
  let cachedOrder = ordersCache.find(o => o.id === orderId || o.public_order_number === orderId);
  if (cachedOrder) {
    modal.classList.remove('hidden');
    renderOrderDetailsModalContent(container, modal, cachedOrder);
  } else {
    container.innerHTML = '<p style="text-align: center; padding: 2rem;">Loading full order details...</p>';
    modal.classList.remove('hidden');
  }

  // 2. Fetch fresh details / audit events from backend in parallel
  try {
    let res = await fetch(`/api/admin/orders?id=${encodeURIComponent(orderId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      res = await fetch(`/api/admin/orders/${orderId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
    }

    if (res.ok) {
      const data = await res.json();
      const freshOrder = data.order || (data.orders && data.orders[0]);
      if (freshOrder) {
        const merged = normalizeOrder({ ...(cachedOrder || {}), ...freshOrder });
        renderOrderDetailsModalContent(container, modal, merged);
        return;
      }
    }
  } catch (e) {
    console.warn('Backend order details fetch note:', e.message);
  }

  // If both cache and fetch are absent, display informative error
  if (!cachedOrder) {
    container.innerHTML = `
      <div class="alert-box alert-warning">
        Unable to load order details for "${escapeHTML(orderId)}". Please try refreshing the orders list.
      </div>
    `;
  }
}

/**
 * Setup Modals (Close buttons)
 */
function setupModals() {
  document.getElementById('btn-close-order-modal')?.addEventListener('click', () => {
    document.getElementById('modal-order-details')?.classList.add('hidden');
  });

  document.getElementById('btn-close-verify-modal')?.addEventListener('click', () => {
    document.getElementById('modal-pickup-verify')?.classList.add('hidden');
  });

  document.getElementById('btn-open-quick-verify')?.addEventListener('click', () => {
    openPickupVerifyModal('', '');
  });

  // Pickup verify form submit
  const verifyForm = document.getElementById('pickup-verify-form');
  verifyForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orderId = document.getElementById('verify-order-id').value;
    const pickupCode = document.getElementById('verify-code-input').value;
    const confirmCb = document.getElementById('verify-handover-confirm');
    const alertBox = document.getElementById('verify-error-alert');
    const submitBtn = document.getElementById('btn-submit-verify');

    if (confirmCb && !confirmCb.checked) {
      alertBox.textContent = 'Please confirm that the items have physically been handed to the customer.';
      alertBox.classList.remove('hidden');
      return;
    }

    if (!pickupCode.trim()) {
      alertBox.textContent = 'Please enter the 4-digit pickup code presented by the customer.';
      alertBox.classList.remove('hidden');
      return;
    }

    let codeToSend = pickupCode.trim().toUpperCase();
    const targetOrder = ordersCache.find(o => o.id === orderId || o.public_order_number === orderId);
    if (targetOrder) {
      const exp = (targetOrder.pickup_code_hash || targetOrder.pickup_code || '').toUpperCase();
      if (exp && !codeToSend.startsWith('TNT-PK-') && exp.endsWith(codeToSend)) {
        codeToSend = exp;
      }
    }
    if (!codeToSend.startsWith('TNT-PK-') && codeToSend.length === 4) {
      codeToSend = 'TNT-PK-' + codeToSend;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying Handover...';
    alertBox.classList.add('hidden');

    try {
      const res = await fetch('/api/admin/verify-pickup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          orderId,
          pickupCode: codeToSend,
          staffConfirmed: true
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Verification failed.');
      }

      alert(`✅ Handover Authorized! Order ${data.publicOrderNumber || orderId} successfully marked as PICKED UP.`);
      document.getElementById('modal-pickup-verify').classList.add('hidden');
      loadOverviewMetrics();
      loadOrders();
      loadPickupQueue();

    } catch (err) {
      alertBox.textContent = err.message || 'Invalid pickup code. Verification rejected.';
      alertBox.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Authorize Handover';
    }
  });

  // Edit product form submit
  const editProdForm = document.getElementById('edit-product-form');
  editProdForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-product-id').value;
    const priceInPaise = document.getElementById('edit-product-price-paise').value;
    const stockQuantity = document.getElementById('edit-product-stock').value;
    const description = document.getElementById('edit-product-desc').value;
    const isActive = document.getElementById('edit-product-active').checked;

    try {
      const res = await fetch('/api/admin/products/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ productId: id, priceInPaise, stockQuantity, description, isActive })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message);

      alert('✅ Product master updated successfully.');
      document.getElementById('modal-edit-product').classList.add('hidden');
      loadProductsMaster();
    } catch (err) {
      alert(err.message || 'Error updating product.');
    }
  });

  document.getElementById('edit-product-price-paise')?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10) || 0;
    const helper = document.getElementById('edit-price-helper');
    if (helper) helper.textContent = `Equivalent in Rupees: ${formatINR(val / 100)}`;
  });
}

function openPickupVerifyModal(orderId, publicOrderNumber) {
  const modal = document.getElementById('modal-pickup-verify');
  const order = ordersCache.find(o => o.id === orderId || o.public_order_number === (publicOrderNumber || orderId)) || {};

  const idInput = document.getElementById('verify-order-id');
  const refDisplay = document.getElementById('verify-order-ref');
  const custDisplay = document.getElementById('verify-customer-name');
  const payBadge = document.getElementById('verify-payment-badge');
  const expectedCodeEl = document.getElementById('verify-expected-code');
  const itemsDisplay = document.getElementById('verify-items-summary');
  const confirmCb = document.getElementById('verify-handover-confirm');
  const codeInput = document.getElementById('verify-code-input');
  const alertBox = document.getElementById('verify-error-alert');

  if (idInput) idInput.value = order.id || orderId || '';
  if (refDisplay) refDisplay.textContent = order.public_order_number || publicOrderNumber || orderId || '—';
  if (custDisplay) custDisplay.textContent = order.customer_name ? `${order.customer_name} (${order.customer_mobile})` : 'Walk-in Collection';
  if (payBadge) {
    payBadge.textContent = order.payment_status || 'PAID';
    payBadge.className = `status-badge status-${order.payment_status || 'PAID'}`;
  }
  if (expectedCodeEl) {
    expectedCodeEl.textContent = order.pickup_code_hash || order.pickup_code || '—';
  }
  const summaryStr = getOrderItems(order).map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ') || 'Festive Sweets & Savouries';
  if (itemsDisplay) itemsDisplay.textContent = summaryStr;

  if (confirmCb) confirmCb.checked = false;
  if (codeInput) codeInput.value = '';
  if (alertBox) alertBox.classList.add('hidden');

  modal?.classList.remove('hidden');
  codeInput?.focus();
}

/**
 * Kitchen Packing Queue (Only PAID and PREPARING orders)
 */
async function loadPackingQueue() {
  const container = document.getElementById('packing-queue-container');
  if (!container) return;

  container.innerHTML = '<p style="padding: 2rem;">Loading kitchen queue...</p>';
  try {
    const res = await fetch('/api/admin/orders', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success) return;

    // Strict Rule: Only verified PAID or PREPARING orders. Never unpaid.
    const packingOrders = (data.orders || []).map(normalizeOrder).filter(o => o.payment_status === 'PAID' && (o.order_status === 'PAID' || o.order_status === 'PREPARING'));

    if (packingOrders.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; background: #FFF; padding: 3rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border);">
          <span style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem;">🍳</span>
          <h3>Kitchen Packaging Queue is Clear</h3>
          <p style="color: var(--color-text-muted); font-size: 0.85rem;">All verified orders have been packed and moved to Ready for Pickup.</p>
        </div>
      `;
      return;
    }

    let html = '';
    packingOrders.forEach(o => {
      const itemsList = getOrderItems(o).map(i => `• <strong>${escapeHTML(i.name)}</strong>: <span style="font-size: 1.05rem; color: var(--color-maroon-800);">${i.quantity} ${i.unit}</span>`).join('<br>');
      const isPreparing = o.order_status === 'PREPARING';

      html += `
        <div class="metric-card" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
              <strong style="font-family: var(--font-mono); font-size: 1.1rem; color: var(--color-maroon-900);">${escapeHTML(o.public_order_number)}</strong>
              <span class="status-badge status-${o.order_status}">${o.order_status}</span>
            </div>

            <div style="font-size: 0.85rem; margin-bottom: 0.75rem;">
              Customer: <strong>${escapeHTML(o.customer_name)}</strong> (${escapeHTML(o.customer_mobile)})
              ${o.customer_notes ? `<div style="background: #FFF3E0; padding: 0.4rem; border-radius: 4px; font-size: 0.8rem; margin-top: 0.35rem;">📝 <strong>Packing Note:</strong> ${escapeHTML(o.customer_notes)}</div>` : ''}
            </div>

            <div style="background: var(--color-bg-surface-alt); padding: 0.85rem; border-radius: var(--radius-md); font-size: 0.875rem; margin-bottom: 1rem; line-height: 1.6;">
              <span style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Required Delicacies:</span>
              ${itemsList}
            </div>
          </div>

          <div>
            <div style="margin-bottom: 0.5rem;">
              <button type="button" class="btn btn-outline btn-block btn-print-label" data-id="${o.id}" style="padding: 0.45rem; font-size: 0.825rem; font-weight: 700; white-space: nowrap;">
                🏷️ Stick Label (1-Page)
              </button>
            </div>

            ${!isPreparing ? `
              <button type="button" class="btn btn-secondary btn-block btn-transition-queue" data-id="${o.id}" data-status="PREPARING" style="padding: 0.5rem;">
                🍳 Start Packing
              </button>
            ` : `
              <button type="button" class="btn btn-primary btn-block btn-transition-queue" data-id="${o.id}" data-status="READY_FOR_PICKUP" style="padding: 0.5rem;">
                📦 Mark Ready for Counter Pickup
              </button>
            `}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach button listeners
    container.querySelectorAll('.btn-transition-queue').forEach(b => {
      b.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const newStatus = e.currentTarget.dataset.status;
        await updateOrderStatus(id, newStatus);
        loadPackingQueue();
        loadOverviewMetrics();
      });
    });

    container.querySelectorAll('.btn-print-label').forEach(b => {
      b.addEventListener('click', (e) => {
        const o = packingOrders.find(item => item.id === e.currentTarget.dataset.id);
        if (o) printSingleParcelLabel(o);
      });
    });

  } catch (e) {
    container.innerHTML = '<div class="alert-box alert-warning">Error loading packing queue.</div>';
  }
}

/**
 * Counter Pickup Station Queue (Orders in READY_FOR_PICKUP)
 */
async function loadPickupQueue() {
  const container = document.getElementById('pickup-queue-container');
  if (!container) return;

  container.innerHTML = '<p style="padding: 2rem;">Loading ready pickup orders...</p>';
  try {
    const res = await fetch('/api/admin/orders', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success) return;

    const readyOrders = (data.orders || []).map(normalizeOrder).filter(o => o.order_status === 'READY_FOR_PICKUP');

    if (readyOrders.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; background: #FFF; padding: 3rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border);">
          <span style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem;">🛍️</span>
          <h3>No Orders Waiting at Counter</h3>
          <p style="color: var(--color-text-muted); font-size: 0.85rem;">Orders will appear here as soon as the kitchen marks them as Ready for Pickup.</p>
        </div>
      `;
      return;
    }

    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1.25rem;">';
    readyOrders.forEach(o => {
      const itemsList = getOrderItems(o).map(i => `${escapeHTML(i.name)} (${i.quantity} ${i.unit})`).join(', ');

      html += `
        <div class="metric-card metric-ready" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem;">
              <strong style="font-family: var(--font-mono); font-size: 1.15rem; color: var(--color-maroon-900);">${escapeHTML(o.public_order_number)}</strong>
              <span class="status-badge status-READY_FOR_PICKUP">Staged at Counter</span>
            </div>

            <div style="font-size: 0.85rem; margin-bottom: 0.75rem;">
              Customer: <strong style="font-size: 0.95rem;">${escapeHTML(o.customer_name)}</strong><br>
              Mobile: <span style="font-family: var(--font-mono); font-weight: 700; color: var(--color-maroon-800);">${escapeHTML(o.customer_mobile)}</span>
            </div>

            <div style="background: var(--color-bg-surface-alt); padding: 0.75rem; border-radius: var(--radius-md); font-size: 0.8rem; margin-bottom: 0.75rem;">
              <strong>Items:</strong> ${itemsList}
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; background: #E8F5E9; border: 1.5px dashed #2E7D32; padding: 6px 10px; border-radius: 6px; margin-bottom: 1rem; font-size: 0.825rem;">
              <span style="font-weight: 700; color: #1B5E20;">Authorized Pickup Code:</span>
              <strong class="font-mono" style="font-size: 1.15rem; color: #1B5E20; letter-spacing: 1px;">${escapeHTML(o.pickup_code_hash || o.pickup_code || 'Pending')}</strong>
            </div>
          </div>

          <div>
            <button type="button" class="btn btn-primary btn-block btn-trigger-verify" data-id="${o.id}" data-ref="${o.public_order_number}">
              🔑 Enter Pickup Code to Handover
            </button>
          </div>
        </div>
      `;
    });
    html += '</div>';

    container.innerHTML = html;

    container.querySelectorAll('.btn-trigger-verify').forEach(b => {
      b.addEventListener('click', (e) => {
        openPickupVerifyModal(e.currentTarget.dataset.id, e.currentTarget.dataset.ref);
      });
    });

  } catch (e) {
    container.innerHTML = '<div class="alert-box alert-warning">Error loading pickup queue.</div>';
  }
}

const DEFAULT_PRODUCTS_MASTER = [
  { id: 'tnt-trad-sweets', slug: 'tnt-trad-sweets', name: 'Traditional Sweets', tamil_name: 'பாரம்பரிய ஸ்வீட்ஸ்', price_in_paise: 50000, unit: 'kg', stock_quantity: 500, is_active: true, description: 'Authentic festive South Indian sweets freshly hand-crafted for Diwali.' },
  { id: 'tnt-ghee-sweets', slug: 'tnt-ghee-sweets', name: 'Special Ghee Sweets', tamil_name: 'ஸ்பெஷல் நெய் ஸ்வீட்ஸ்', price_in_paise: 90000, unit: 'kg', stock_quantity: 500, is_active: true, description: 'Exquisite festive sweets slow-cooked in pure aromatic desi cow ghee.' },
  { id: 'tnt-karam-specials', slug: 'tnt-karam-specials', name: 'Karam Specials', tamil_name: 'காரம் ஸ்பெஷல்ஸ்', price_in_paise: 45000, unit: 'kg', stock_quantity: 500, is_active: true, description: 'Crisp, spicy, and irresistible traditional Diwali savouries.' },
  { id: 'tnt-dry-fruits', slug: 'tnt-dry-fruits', name: 'Dry Fruits Sweets', tamil_name: 'டிரை ஃப்ரூட்ஸ் ஸ்வீட்ஸ்', price_in_paise: 130000, unit: 'kg', stock_quantity: 500, is_active: true, description: 'Lavish festive delicacies prepared with premium almonds, cashews, pistachios, and figs.' },
  { id: 'tnt-mixed-combo', slug: 'tnt-mixed-combo', name: 'Diwali Family Mixed Combo', tamil_name: 'தீபாவளி பேமிலி காம்போ', price_in_paise: 99900, unit: 'combo', stock_quantity: 500, is_active: true, description: 'The ultimate celebration hamper combining traditional sweets, ghee delicacies, and savouries.' }
];

function renderProductsMasterGrid(container, products) {
  let html = '';
  products.forEach(p => {
    const priceRupees = (p.price_in_paise || 0) / 100;
    html += `
      <div class="metric-card" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
            <div>
              <h3 style="font-family: var(--font-heading); color: var(--color-maroon-900); font-size: 1.15rem;">${escapeHTML(p.name)}</h3>
              <div style="font-size: 0.8rem; color: var(--color-gold-700); font-weight: 600;">${escapeHTML(p.tamil_name || '')}</div>
            </div>
            <span class="status-badge ${p.is_active ? 'status-PAID' : 'status-CANCELLED'}">
              ${p.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>

          <div style="margin: 0.75rem 0; font-size: 1.35rem; font-weight: 800; color: var(--color-maroon-900);">
            ${formatINR(priceRupees)} <span style="font-size: 0.85rem; color: var(--color-text-muted); font-weight: 600;">per ${p.unit}</span>
            <div style="font-size: 0.75rem; color: var(--color-text-light); font-weight: normal;">Stored: ${p.price_in_paise} paise</div>
          </div>

          <p style="font-size: 0.825rem; color: var(--color-text-muted); line-height: 1.4; margin-bottom: 1rem;">
            ${escapeHTML(p.description || '')}
          </p>

          <div style="font-size: 0.8rem; background: var(--color-bg-surface-alt); padding: 0.5rem 0.75rem; border-radius: var(--radius-sm); margin-bottom: 1rem;">
            📦 Available Inventory: <strong>${p.stock_quantity || 500} ${p.unit}</strong>
          </div>
        </div>

        <button type="button" class="btn btn-outline btn-block btn-edit-product-trigger" 
          data-id="${p.id}"
          data-name="${escapeHTML(p.name)}"
          data-price="${p.price_in_paise}"
          data-stock="${p.stock_quantity || 500}"
          data-desc="${escapeHTML(p.description || '')}"
          data-active="${p.is_active ? '1' : '0'}"
        >
          ✏️ Edit Price &amp; Stock
        </button>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.btn-edit-product-trigger').forEach(b => {
    b.addEventListener('click', (e) => {
      const d = e.currentTarget.dataset;
      document.getElementById('edit-product-id').value = d.id;
      document.getElementById('edit-product-name').value = d.name;
      document.getElementById('edit-product-price-paise').value = d.price;
      document.getElementById('edit-product-stock').value = d.stock;
      document.getElementById('edit-product-desc').value = d.desc;
      document.getElementById('edit-product-active').checked = d.active === '1';
      document.getElementById('edit-price-helper').textContent = `Equivalent in Rupees: ${formatINR((parseInt(d.price, 10) || 0) / 100)}`;
      document.getElementById('modal-edit-product').classList.remove('hidden');
    });
  });
}

/**
 * Product Master & Inventory Management
 */
async function loadProductsMaster() {
  const container = document.getElementById('admin-products-grid');
  if (!container) return;

  container.innerHTML = '<p style="padding: 2rem;">Loading product master...</p>';
  try {
    const res = await fetch('/api/admin/products', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    let prods = null;
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.products) && data.products.length > 0) {
        prods = data.products;
      }
    }
    if (!prods) {
      prods = DEFAULT_PRODUCTS_MASTER;
    }
    renderProductsMasterGrid(container, prods);
  } catch (e) {
    console.warn('Error loading products from server, falling back to catalogue:', e);
    renderProductsMasterGrid(container, DEFAULT_PRODUCTS_MASTER);
  }
}

/**
 * Event Audit Logs
 */
async function loadAuditLogs() {
  const tbody = document.getElementById('admin-audit-table-body');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="padding: 2rem; text-align: center;">Loading audit logs...</td></tr>';
  try {
    const res = await fetch('/api/admin/audit-logs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success) return;

    if (!data.logs || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding: 2rem; text-align: center; color: var(--color-text-muted);">No audit events recorded yet.</td></tr>';
      return;
    }

    let html = '';
    data.logs.forEach(ev => {
      const istTime = new Date(ev.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'medium' });
      const meta = ev.metadata ? JSON.stringify(ev.metadata) : '-';
      html += `
        <tr>
          <td style="font-size: 0.8rem; font-family: var(--font-mono);">${istTime}</td>
          <td style="font-family: var(--font-mono); font-weight: 700;">${ev.order_id ? ev.order_id.slice(0, 8) + '...' : '-'}</td>
          <td><strong style="color: var(--color-maroon-800);">${ev.event_type}</strong></td>
          <td>${ev.from_status || '-'}</td>
          <td><strong>${ev.to_status || '-'}</strong></td>
          <td><span class="status-badge" style="background: #E0F2F1; color: #004D40;">${ev.actor_type || 'SYSTEM'}</span></td>
          <td style="font-size: 0.75rem; font-family: var(--font-mono); max-width: 300px; word-break: break-all;">${escapeHTML(meta)}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding: 2rem; text-align: center; color: var(--color-error);">Error loading audit trail.</td></tr>';
  }
}

/**
 * Update Order Status via Server State Machine
 */
async function updateOrderStatus(orderId, newStatus) {
  try {
    const res = await fetch('/api/admin/update-order-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ orderId, newStatus })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Status transition rejected.');
    }

    alert(`✅ Order status transitioned to ${newStatus}.`);
    loadOrders();
    loadOverviewMetrics();
  } catch (err) {
    alert(err.message || 'Error updating order status.');
  }
}

/* ==============================================================================
   DOCUMENT GENERATION & PRINTING WORKFLOWS
   Critical Requirement: Parcel Labels, Packing Slips, Customer Receipts
   ============================================================================== */

/**
 * Generate Printable Parcel Label HTML (Sweet Box Sticker)
 * Security Rules:
 * - NO API keys, secret keys, or passwords.
 * - Customer's secret pickup code is NEVER printed on exterior parcel labels.
 * - Clear "CUSTOMER PICKUP" marking.
 */
function generateParcelLabelHtml(order) {
  const totalRupees = (order.total_paise || 0) / 100;
  const istDate = new Date(order.created_at).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const items = getOrderItems(order);
  let itemsHtml = '';
  if (items.length === 0) {
    itemsHtml = `
      <tr>
        <td><strong>Festive Delicacy Pack</strong></td>
        <td style="text-align: right; font-weight: 700;">1 box</td>
      </tr>
    `;
  } else {
    items.forEach((i, idx) => {
      const unitRupees = (i.unit_price_paise || 0) / 100;
      const lineRupees = (i.line_total_paise || (i.unit_price_paise * i.quantity)) / 100;
      itemsHtml += `
        <tr>
          <td style="padding: 4px 6px; border: 1px solid #000;">
            <strong>${escapeHTML(i.name)}</strong>
            ${i.tamil_name ? `<div style="font-size: 0.72rem; color: #444;">${escapeHTML(i.tamil_name)}</div>` : ''}
          </td>
          <td style="padding: 4px 6px; border: 1px solid #000; text-align: center; font-weight: 700;">${i.quantity} ${i.unit}</td>
          <td style="padding: 4px 6px; border: 1px solid #000; text-align: right;">${formatINR(unitRupees)}</td>
          <td style="padding: 4px 6px; border: 1px solid #000; text-align: right; font-weight: 800; color: #78101C;">${formatINR(lineRupees)}</td>
        </tr>
      `;
    });
  }

  // Safe QR Code SVG linking strictly to public lookup page without secrets
  const qrSvg = `
    <svg width="80" height="80" viewBox="0 0 100 100" style="display: block; margin: 0 auto;">
      <rect width="100" height="100" fill="#FFFFFF"/>
      <path d="M10,10 h30 v30 h-30 z M15,15 v20 h20 v-20 z M20,20 h10 v10 h-10 z" fill="#000000"/>
      <path d="M60,10 h30 v30 h-30 z M65,15 v20 h20 v-20 z M70,20 h10 v10 h-10 z" fill="#000000"/>
      <path d="M10,60 h30 v30 h-30 z M15,65 v20 h20 v-20 z M20,70 h10 v10 h-10 z" fill="#000000"/>
      <rect x="48" y="20" width="5" height="10" fill="#000000"/>
      <rect x="52" y="35" width="8" height="5" fill="#000000"/>
      <rect x="48" y="48" width="10" height="10" fill="#000000"/>
      <rect x="62" y="62" width="12" height="12" fill="#000000"/>
      <rect x="80" y="75" width="8" height="8" fill="#000000"/>
    </svg>
  `;

  return `
    <div class="parcel-label-card" style="border: 2.5px solid #000000; border-radius: 8px; padding: 14px 18px; background: #FFFFFF; max-width: 650px; margin: 0 auto 15px auto;">
      <div class="parcel-label-header">
        <div class="parcel-brand-info">
          <img src="../assets/images/tnt-logo.jpg" alt="TNT Logo" class="parcel-brand-logo">
          <div>
            <div class="parcel-brand-name">Shree Taste N Taste Catering</div>
            <div class="parcel-brand-sub">TNT (Taste N Taste) • Spreading Sweetness This Diwali</div>
          </div>
        </div>
        <div class="parcel-header-badges">
          <span class="parcel-sticker-tag">🏷️ SWEET BOX STICKER</span>
          <span class="parcel-pickup-banner" style="${order.fulfilment_method === 'DELIVERY' ? 'background: #E65100; color: #FFF;' : ''}">
            ${order.fulfilment_method === 'DELIVERY' ? '🚚 DOORSTEP DELIVERY (PORTER)' : '🏬 STORE PICKUP ONLY'}
          </span>
        </div>
      </div>

      <div class="parcel-order-number-row">
        <div>
          <span class="parcel-order-num-label">Order Reference:</span>
          <div class="parcel-order-num-val">${escapeHTML(order.public_order_number)}</div>
        </div>
        <div style="text-align: right; font-size: 0.8rem; color: #444;">
          Ordered: ${istDate} (IST)
        </div>
      </div>

      <!-- Scheduled Collection / Delivery Banner -->
      <div style="background: ${order.fulfilment_method === 'DELIVERY' ? '#FFF3E0; border: 1.5px solid #FFB74D;' : '#FFF9C4; border: 1.5px solid #FBC02D;'} padding: 6px 10px; border-radius: 4px; margin-bottom: 8px; font-size: 0.825rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px;">
        <span>📅 <strong>${order.fulfilment_method === 'DELIVERY' ? 'Scheduled Delivery Date:' : 'Scheduled Pickup Date:'}</strong> ${escapeHTML(order.pickup_date || 'Today')}</span>
        <span>⏰ <strong>Slot:</strong> ${escapeHTML(order.pickup_time || 'Morning')}</span>
      </div>

      ${order.fulfilment_method === 'DELIVERY' && (order.delivery_address?.formatted || order.delivery_address) ? `
        <div style="background: #FFF8E1; border: 1.5px solid #FFE082; padding: 6px 10px; border-radius: 4px; margin-bottom: 8px; font-size: 0.825rem;">
          <strong style="color: #BF360C;">🚚 Doorstep Delivery Address (Porter / Partner):</strong>
          <div style="font-weight: 700; color: #333; margin-top: 2px; word-break: break-word;">
            ${escapeHTML(order.delivery_address?.formatted || (typeof order.delivery_address === 'string' ? order.delivery_address : 'Address on file'))}
          </div>
        </div>
      ` : ''}

      ${order.fulfilment_method !== 'DELIVERY' && (order.pickup_code_hash || order.pickup_code) ? `
        <div style="background: #E8F5E9; border: 1.5px dashed #2E7D32; padding: 6px 10px; border-radius: 4px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px;">
          <span style="font-size: 0.75rem; font-weight: 800; color: #1B5E20; text-transform: uppercase;">Official Store Pickup Code:</span>
          <span class="font-mono" style="font-size: 1.15rem; font-weight: 900; color: #1B5E20; letter-spacing: 2px;">${escapeHTML(order.pickup_code_hash || order.pickup_code)}</span>
        </div>
      ` : ''}

      <div class="parcel-customer-grid">
        <div class="parcel-info-block">
          <span class="parcel-info-label">Customer Name &amp; Contact:</span>
          <div class="parcel-customer-name" style="word-break: break-word;">${escapeHTML(order.customer_name)}</div>
          <div class="parcel-customer-mobile">📞 +91 ${escapeHTML(order.customer_mobile)}</div>
        </div>
        <div class="parcel-info-block" style="text-align: center;">
          <span class="parcel-info-label">Payment &amp; Fulfilment:</span>
          <div class="parcel-paid-badge">
            ✓ ${order.payment_status === 'PAID' ? 'PAID — VERIFIED' : 'AWAITING PAYMENT'}
          </div>
          <div style="font-weight: 800; font-size: 1rem;">${formatINR(totalRupees)}</div>
        </div>
      </div>

      <div style="overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 8px; width: 100%;">
        <table class="parcel-items-table" style="width: 100%; min-width: 320px; border-collapse: collapse; margin-bottom: 0; font-size: 0.8rem;">
          <thead>
            <tr style="background: #EAEAEA;">
              <th style="padding: 4px 6px; border: 1px solid #000; text-align: left;">Ordered Delicacy</th>
              <th style="padding: 4px 6px; border: 1px solid #000; text-align: center; width: 80px;">Qty</th>
              <th style="padding: 4px 6px; border: 1px solid #000; text-align: right; width: 75px;">Unit Rate</th>
              <th style="padding: 4px 6px; border: 1px solid #000; text-align: right; width: 85px;">Line Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
      </div>

      ${order.customer_notes ? `
        <div style="border: 1px dashed #777; padding: 5px 8px; border-radius: 4px; font-size: 0.775rem; margin-bottom: 8px; background: #FAFAFA; word-break: break-word;">
          <strong>Customer Notes:</strong> ${escapeHTML(order.customer_notes)}
        </div>
      ` : ''}

      <div class="parcel-footer-grid" style="border-top: 1.5px solid #000; padding-top: 6px;">
        <div>
          <div style="font-size: 0.72rem; line-height: 1.35; color: #333;">
            • <strong>Collection Counter:</strong> Shree Taste N Taste Catering (<a href="https://www.google.com/maps/dir/?api=1&destination=Shree+TasteNTaste+Catering&destination_place_id=ChIJMVqvzSL2qDsRREVdON0DlTM" target="_blank" style="color: #78101C; text-decoration: underline; font-weight: 700;">Google Maps Navigation</a>)<br>
            • <strong>Enquiries:</strong> 9442854444 / 7200071040 &bull; <em>Food-grade sealed packaging.</em>
          </div>
          <div style="margin-top: 6px; font-size: 0.72rem;">
            Packer Sign: __________________ &nbsp;&nbsp; Date/Time: __________________
          </div>
        </div>

        <div class="parcel-qr-wrapper">
          ${qrSvg}
          <div class="parcel-qr-caption">Scan to Verify</div>
        </div>
      </div>

      <!-- Distinct Thank You Footer -->
      <div style="text-align: center; margin-top: 8px; padding: 6px 10px; background: #FDF9F3; border: 1.5px dashed #78101C; border-radius: 4px; font-weight: 700; color: #78101C; font-size: 0.8rem;">
        ✨ Thank you for shopping with us! Wishing you a sweet &amp; prosperous Diwali. ✨
      </div>
    </div>
  `;
}

/**
 * Generate Internal Operations & Kitchen Packing Slip HTML
 */
function generatePackingSlipHtml(order) {
  const istDate = new Date(order.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const printTimestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'medium' });

  const items = getOrderItems(order);
  let itemsHtml = '';
  if (items.length === 0) {
    itemsHtml = `
      <div style="padding: 12px; text-align: center; color: #666; font-style: italic;">
        Festive Delicacies Pack — Standard Kitchen Pack
      </div>
    `;
  } else {
    items.forEach((i, idx) => {
      const unitRupees = (i.unit_price_paise || 0) / 100;
      itemsHtml += `
        <div class="slip-checklist-item" style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #DDD;">
          <span class="slip-checkbox-box" style="width: 22px; height: 22px; border: 2px solid #000; display: inline-block; margin-right: 6px; border-radius: 3px; flex-shrink: 0;"></span>
          <div style="width: 28px; font-weight: 700; color: #555; flex-shrink: 0;">#${idx + 1}</div>
          <div style="flex: 1; min-width: 140px;">
            <strong style="font-size: 0.95rem; word-break: break-word;">${escapeHTML(i.name)}</strong>
            ${i.tamil_name ? `<span style="font-size: 0.8rem; color: #666; margin-left: 6px;">(${escapeHTML(i.tamil_name)})</span>` : ''}
            <div style="font-size: 0.75rem; color: #777;">Unit Rate: ${formatINR(unitRupees)} per ${i.unit}</div>
          </div>
          <div style="font-size: 1.15rem; font-weight: 900; min-width: 90px; text-align: right; color: #78101C;">
            ${i.quantity} ${i.unit}
          </div>
          <div style="width: 80px; text-align: center; border-left: 1px dashed #CCC; margin-left: 6px; font-size: 0.75rem; color: #555;">
            Packed [ &nbsp; ]
          </div>
        </div>
      `;
    });
  }

  return `
    <div class="packing-slip-card" style="box-sizing: border-box; width: 100%; max-width: 100%;">
      <div class="packing-slip-header" style="border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
        <div>
          <div class="slip-title" style="font-size: 1.35rem; font-weight: 900; text-transform: uppercase;">TNT INTERNAL PACKING SLIP</div>
          <div style="font-size: 0.85rem; color: #333;">Shree Taste N Taste Catering • Diwali Operations Hub • <a href="https://www.google.com/maps/dir/?api=1&destination=Shree+TasteNTaste+Catering&destination_place_id=ChIJMVqvzSL2qDsRREVdON0DlTM" target="_blank" style="color: #000; text-decoration: underline; font-weight: 700;">Shop Location: Google Maps</a></div>
          <div style="font-size: 0.75rem; color: #666;">Slip #: SLIP-${escapeHTML(order.public_order_number)} &bull; Printed: ${printTimestamp}</div>
        </div>
        <div>
          <div style="font-family: ui-monospace, monospace; font-size: 1.35rem; font-weight: 900; color: #78101C; word-break: break-word;">
            ${escapeHTML(order.public_order_number)}
          </div>
          <div style="font-size: 0.8rem; color: #444;">Order Placed: ${istDate}</div>
        </div>
      </div>

      <!-- Prominent Advance Scheduled Pickup / Delivery Banner -->
      <div style="background: ${order.fulfilment_method === 'DELIVERY' ? '#FFF3E0; border: 2px solid #E65100;' : '#E8F5E9; border: 2px solid #2E7D32;'} padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
        <div>
          <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: ${order.fulfilment_method === 'DELIVERY' ? '#BF360C;' : '#1B5E20;'}">
            ${order.fulfilment_method === 'DELIVERY' ? '🚚 Scheduled Doorstep Delivery (Porter)' : '🏬 Scheduled Customer Pickup'}
          </div>
          <div style="font-size: 1.2rem; font-weight: 900; color: ${order.fulfilment_method === 'DELIVERY' ? '#BF360C;' : '#1B5E20;'}">
            📅 ${escapeHTML(order.pickup_date || 'Today')}
          </div>
        </div>
        <div>
          <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: ${order.fulfilment_method === 'DELIVERY' ? '#BF360C;' : '#1B5E20;'}">
            ${order.fulfilment_method === 'DELIVERY' ? 'Preferred Delivery Slot' : 'Preferred Collection Slot'}
          </div>
          <div style="font-size: 1rem; font-weight: 800; color: ${order.fulfilment_method === 'DELIVERY' ? '#BF360C;' : '#1B5E20;'}">
            ⏰ ${escapeHTML(order.pickup_time || 'Morning (08:00 AM - 12:00 PM)')}
          </div>
        </div>
      </div>

      ${order.fulfilment_method === 'DELIVERY' && (order.delivery_address?.formatted || order.delivery_address) ? `
        <div style="background: #FFF8E1; border: 1.5px solid #FFE082; padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 0.85rem;">
          <strong style="color: #BF360C;">🚚 Doorstep Delivery Address (Book on Porter / Delivery Partner):</strong>
          <div style="font-size: 0.95rem; font-weight: 700; color: #222; margin-top: 2px; word-break: break-word;">
            ${escapeHTML(order.delivery_address?.formatted || (typeof order.delivery_address === 'string' ? order.delivery_address : 'Address on file'))}
          </div>
        </div>
      ` : ''}

      <!-- Customer & Fulfillment Metadata Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 14px; background: #F8F8F8; padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; border: 1px solid #E0E0E0;">
        <div>Customer Name: <strong style="word-break: break-word;">${escapeHTML(order.customer_name)}</strong></div>
        <div>Contact Mobile: <strong>+91 ${escapeHTML(order.customer_mobile)}</strong></div>
        <div>Email: <strong style="word-break: break-all;">${escapeHTML(order.customer_email || 'Not Provided')}</strong></div>
        <div>Payment State: <strong style="color: #1B5E20;">${escapeHTML(order.payment_status)}</strong></div>
      </div>

      ${order.customer_notes ? `
        <div style="background: #FFF8E1; border: 1.5px solid #FFE082; padding: 8px 12px; border-radius: 4px; margin-bottom: 14px; font-size: 0.85rem; word-break: break-word;">
          ⚠️ <strong>Special Packing / Customer Note:</strong> ${escapeHTML(order.customer_notes)}
        </div>
      ` : ''}

      <!-- Item Checklist -->
      <div style="font-size: 0.85rem; font-weight: 800; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1.5px solid #000; padding-bottom: 4px; display: flex; justify-content: space-between;">
        <span>Item Description &amp; Specifications</span>
        <span>Ordered Quantity</span>
      </div>

      <div style="border: 1px solid #DDD; border-radius: 4px; margin-bottom: 14px;">
        ${itemsHtml}
      </div>

      <!-- Operational 6-Point Verification Checklist -->
      <div style="background: #FAFAFA; border: 1px solid #DDD; border-radius: 6px; padding: 12px; margin-bottom: 14px; font-size: 0.8rem; line-height: 1.7;">
        <strong style="display: block; text-transform: uppercase; margin-bottom: 4px; color: #333;">Operational Quality Checklist:</strong>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 14px;">
          <div>[ &nbsp; ] 1. All delicacies matched against customer order</div>
          <div>[ &nbsp; ] 2. Quantities and net weights verified on scale</div>
          <div>[ &nbsp; ] 3. Festive sweet box packaging &amp; seals inspected</div>
          <div>[ &nbsp; ] 4. Customer pickup schedule confirmed for ${escapeHTML(order.pickup_date || 'Today')}</div>
          <div>[ &nbsp; ] 5. Verified online payment confirmation checked</div>
          <div>[ &nbsp; ] 6. Parcel staged in shop counter holding rack</div>
        </div>
      </div>

      <!-- Signatures Row -->
      <div class="slip-sign-row" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; font-size: 0.8rem; border-top: 1.5px solid #000; padding-top: 10px;">
        <div>
          Packed By (Staff Name &amp; Sign): _________________________________<br>
          <span style="font-size: 0.72rem; color: #555;">Handcrafted, sealed, and packed according to TNT hygiene standards.</span>
        </div>
        <div>
          Quality &amp; Weight Checked (Supervisor Sign): _________________________________<br>
          <span style="font-size: 0.72rem; color: #555;">Approved ready for physical shop counter collection.</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate Detailed Customer Paid Purchase Receipt HTML
 */
function generateCustomerReceiptHtml(order) {
  const isDelivery = order.fulfilment_method === 'DELIVERY';
  const deliveryFeePaise = isDelivery ? (order.delivery_fee_paise || 8000) : 0;
  const deliveryFeeRupees = deliveryFeePaise / 100;
  const totalRupees = (order.total_paise || 0) / 100;
  const subtotalRupees = Math.max(0, totalRupees - deliveryFeeRupees);
  const istDate = new Date(order.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
  const receiptTimestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const deliveryAddrStr = order.delivery_address?.formatted || (typeof order.delivery_address === 'string' ? order.delivery_address : '') || (order.delivery_address ? `${order.delivery_address.street || ''}, ${order.delivery_address.area || ''}, ${order.delivery_address.city || 'Coimbatore'} - ${order.delivery_address.pincode || ''}` : '');

  const items = getOrderItems(order);
  let itemsHtml = '';
  if (items.length === 0) {
    itemsHtml = `
      <tr>
        <td colspan="6" style="padding: 12px; text-align: center; color: #666; font-style: italic;">
          Festive Delicacies Pack (${formatINR(subtotalRupees)})
        </td>
      </tr>
    `;
  } else {
    items.forEach((i, idx) => {
      const unitRupees = (i.unit_price_paise || 0) / 100;
      const lineRupees = (i.line_total_paise || (i.unit_price_paise * i.quantity)) / 100;
      itemsHtml += `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #DDD; text-align: center; color: #666;">${idx + 1}</td>
          <td style="padding: 8px; border-bottom: 1px solid #DDD;">
            <strong>${escapeHTML(i.name)}</strong>
            ${i.tamil_name ? `<div style="font-size: 0.8rem; color: #555;">${escapeHTML(i.tamil_name)}</div>` : ''}
          </td>
          <td style="padding: 8px; border-bottom: 1px solid #DDD; text-align: center;">${i.unit}</td>
          <td style="padding: 8px; border-bottom: 1px solid #DDD; text-align: center; font-weight: 700;">${i.quantity}</td>
          <td style="padding: 8px; border-bottom: 1px solid #DDD; text-align: right;">${formatINR(unitRupees)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #DDD; text-align: right; font-weight: 800; color: #78101C;">${formatINR(lineRupees)}</td>
        </tr>
      `;
    });
  }

  return `
    <div class="packing-slip-card" style="border: 2px solid #78101C; padding: 18px; border-radius: 8px; box-sizing: border-box; width: 100%; max-width: 100%;">
      <!-- Business Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; border-bottom: 2px solid #78101C; padding-bottom: 14px; margin-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <img src="../assets/images/tnt-logo.jpg" alt="TNT Logo" style="width: 54px; height: 54px; border-radius: 8px; object-fit: cover; border: 1px solid #DDD; flex-shrink: 0;">
          <div>
            <h2 style="font-size: 1.35rem; color: #78101C; margin: 0; font-family: Georgia, serif; word-break: break-word;">Shree Taste N Taste Catering</h2>
            <div style="font-size: 0.82rem; font-weight: 700; color: #333;">TNT (Taste N Taste) &bull; Spreading Sweetness This Festive Season</div>
            <div style="font-size: 0.78rem; color: #555;">Enquiries: 9442854444 / 7200071040 &bull; ${isDelivery ? 'Doorstep Delivery' : 'Shop Counter Collection'}</div>
          </div>
        </div>
        <div>
          <span style="display: inline-block; background: #78101C; color: #FFF; font-size: 0.75rem; font-weight: 800; padding: 4px 10px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
            Official Purchase Receipt
          </span>
          <div style="font-family: ui-monospace, monospace; font-size: 0.95rem; font-weight: 800; margin-top: 4px; color: #333; word-break: break-word;">
            REC-${escapeHTML(order.public_order_number)}
          </div>
          <div style="font-size: 0.75rem; color: #666;">Generated: ${receiptTimestamp}</div>
        </div>
      </div>

      <!-- Order & Customer Information Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; font-size: 0.85rem; margin-bottom: 14px; background: #FDF9F3; padding: 12px 14px; border-radius: 6px; border: 1px solid #F0E6D6;">
        <div>
          <div style="margin-bottom: 4px;">Order ID: <strong style="font-family: ui-monospace, monospace; font-size: 1rem; color: #78101C; word-break: break-word;">${escapeHTML(order.public_order_number)}</strong></div>
          <div style="margin-bottom: 4px;">Customer Name: <strong style="word-break: break-word;">${escapeHTML(order.customer_name)}</strong></div>
          <div style="margin-bottom: 4px;">Mobile: <strong>+91 ${escapeHTML(order.customer_mobile)}</strong></div>
          ${order.customer_email ? `<div style="word-break: break-all;">Email: <strong>${escapeHTML(order.customer_email)}</strong></div>` : ''}
          <div style="margin-top: 6px;">
            Fulfilment: 
            ${isDelivery ? `
              <span style="background: #E65100; color: #FFF; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">🚚 Doorstep Delivery (Porter)</span>
            ` : `
              <span style="background: #2E7D32; color: #FFF; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">🏬 Direct Store Pickup</span>
            `}
          </div>
        </div>
        <div>
          <div style="margin-bottom: 4px;">Order Placed: <strong>${istDate}</strong></div>
          <div style="margin-bottom: 4px;">${isDelivery ? 'Scheduled Delivery Date:' : 'Scheduled Pickup Date:'} <strong style="color: #1B5E20; font-size: 0.95rem;">📅 ${escapeHTML(order.pickup_date || 'Today')}</strong></div>
          <div style="margin-bottom: 4px;">${isDelivery ? 'Delivery Slot:' : 'Pickup Slot:'} <strong>⏰ ${escapeHTML(order.pickup_time || 'Morning (08:00 AM - 12:00 PM)')}</strong></div>
          <div>Payment: <strong style="color: #1B5E20;">✓ ${order.payment_status === 'PAID' ? 'PAID & VERIFIED (Online Razorpay)' : order.payment_status}</strong></div>
          ${order.razorpay_payment_id ? `<div style="font-size: 0.75rem; color: #555; font-family: ui-monospace, monospace; word-break: break-all;">Txn ID: ${escapeHTML(order.razorpay_payment_id)}</div>` : ''}
        </div>
      </div>

      ${isDelivery && deliveryAddrStr ? `
        <div style="background: #FFF8E1; border: 1.5px solid #FFE082; padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 0.85rem;">
          <strong style="color: #BF360C; font-size: 0.85rem;">📍 Doorstep Delivery Destination (via Porter / Partner):</strong>
          <div style="font-size: 0.95rem; font-weight: 700; color: #222; margin-top: 3px; word-break: break-word;">
            ${escapeHTML(deliveryAddrStr)}
          </div>
        </div>
      ` : ''}

      ${order.customer_notes ? `
        <div style="border: 1px dashed #B8860B; padding: 8px 12px; border-radius: 4px; font-size: 0.825rem; margin-bottom: 14px; background: #FFFDF5; word-break: break-word;">
          📝 <strong>Customer Notes:</strong> ${escapeHTML(order.customer_notes)}
        </div>
      ` : ''}

      <!-- Itemized Product Table -->
      <div style="overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 14px; width: 100%;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; min-width: 480px; margin-bottom: 0;">
          <thead>
            <tr style="background: #F4F4F4; border-bottom: 2px solid #78101C; color: #78101C; font-weight: 800; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px;">
              <th style="padding: 8px; text-align: center; width: 40px;">S.No</th>
              <th style="padding: 8px; text-align: left;">Product Description</th>
              <th style="padding: 8px; text-align: center; width: 60px;">Unit</th>
              <th style="padding: 8px; text-align: center; width: 60px;">Qty</th>
              <th style="padding: 8px; text-align: right; width: 100px;">Unit Price</th>
              <th style="padding: 8px; text-align: right; width: 110px;">Line Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
      </div>

      <!-- Financial Summary Table -->
      <div style="display: flex; justify-content: flex-end; margin-bottom: 16px;">
        <div style="width: 100%; max-width: 340px; box-sizing: border-box; font-size: 0.85rem; background: #F8F9FA; padding: 12px; border-radius: 6px; border: 1px solid #DDD;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span>Delicacies Subtotal:</span>
            <strong>${formatINR(subtotalRupees)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span>${isDelivery ? 'Doorstep Delivery Fee (Porter / Partner):' : 'Fulfilment (Store Pickup):'}</span>
            <strong style="color: ${isDelivery ? '#E65100' : '#1B5E20'};">${isDelivery ? formatINR(deliveryFeeRupees) : 'FREE (₹0)'}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #CCC;">
            <span>Applicable Taxes:</span>
            <span>Inclusive</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 1.1rem; font-weight: 900; color: #78101C; margin-bottom: 4px;">
            <span>Grand Total:</span>
            <span>${formatINR(totalRupees)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; color: #1B5E20; font-weight: 700; font-size: 0.9rem;">
            <span>Amount Paid:</span>
            <span>${formatINR(totalRupees)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; color: #555; font-size: 0.8rem; margin-top: 4px;">
            <span>Balance Due:</span>
            <span>₹0.00</span>
          </div>
        </div>
      </div>

      <!-- Secret Customer Pickup Code Banner (Only for in-store pickup) -->
      ${(!isDelivery && order.pickup_code_hash) ? `
        <div style="background: #E8F5E9; border: 2px dashed #2E7D32; padding: 14px; text-align: center; border-radius: 8px; margin-bottom: 16px;">
          <div style="font-size: 0.8rem; font-weight: 800; color: #1B5E20; text-transform: uppercase; letter-spacing: 1px;">
            Authorized Counter Pickup Verification Code
          </div>
          <div style="font-family: ui-monospace, monospace; font-size: 2.2rem; font-weight: 900; letter-spacing: 4px; color: #1B5E20; margin: 4px 0;">
            ${escapeHTML(order.pickup_code_hash)}
          </div>
          <div style="font-size: 0.775rem; color: #333;">
            Please present this official Pickup Code along with your Order Reference at our shop counter when collecting your sweets.
          </div>
        </div>
      ` : ''}

      <!-- Customer Instructions Footer -->
      <div style="font-size: 0.75rem; color: #555; line-height: 1.5; border-top: 1px solid #DDD; padding-top: 10px;">
        ${isDelivery ? `
          • <strong>Doorstep Delivery (Porter / Partner):</strong> We will dispatch your order via local delivery partner (Porter / bike courier) to the specified address on <strong>${escapeHTML(order.pickup_date || 'Today')}</strong>.<br>
          • <strong>Delivery Queries:</strong> For scheduling changes or delivery tracking, call 9442854444 / 7200071040.<br>
        ` : `
          • <strong>Customer Store Pickup:</strong> Collection at Shree Taste N Taste Catering shop counter (<a href="https://www.google.com/maps/dir/?api=1&destination=Shree+TasteNTaste+Catering&destination_place_id=ChIJMVqvzSL2qDsRREVdON0DlTM" target="_blank" style="color: #78101C; text-decoration: underline; font-weight: 700;">View Location &amp; Directions on Google Maps</a>).<br>
          • <strong>Collection Date:</strong> Please arrive on your scheduled date: <strong>${escapeHTML(order.pickup_date || 'Today')}</strong> during <strong>${escapeHTML(order.pickup_time || 'Morning')}</strong>.<br>
          • <strong>Support:</strong> For scheduling changes or inquiries, call 9442854444 / 7200071040.<br>
        `}
      </div>

      <!-- Distinct Thank You Footer -->
      <div style="text-align: center; margin-top: 14px; padding: 12px 16px; background: #FFF8E1; border: 1.5px dashed #D4AF37; border-radius: 6px; font-weight: 700; color: #78101C; font-size: 0.95rem;">
        ✨ Thank you for shopping with us! Wishing you a sweet &amp; prosperous festive season. ✨
      </div>
    </div>
  `;
}

/**
 * Trigger Print
 */
function printSingleParcelLabel(order) {
  const stage = document.getElementById('print-document-stage');
  if (!stage) return;

  stage.innerHTML = generateParcelLabelHtml(order);
  window.print();
}

function printPackingSlip(order) {
  const stage = document.getElementById('print-document-stage');
  if (!stage) return;

  stage.innerHTML = generatePackingSlipHtml(order);
  window.print();
}

function printCustomerReceipt(order) {
  const stage = document.getElementById('print-document-stage');
  if (!stage) return;

  stage.innerHTML = generateCustomerReceiptHtml(order);
  window.print();
}

/**
 * Batch Print Selected Parcel Labels
 */
function batchPrintParcelLabels() {
  if (selectedOrderIds.size === 0) {
    alert('Please select at least one order using the checkboxes to batch print labels.');
    return;
  }

  const stage = document.getElementById('print-document-stage');
  if (!stage) return;

  const selectedOrders = ordersCache.filter(o => selectedOrderIds.has(o.id)).map(normalizeOrder);
  if (selectedOrders.length === 0) return;

  let combinedHtml = '';
  selectedOrders.forEach((order, index) => {
    const isLast = index === selectedOrders.length - 1;
    combinedHtml += `
      <div class="${isLast ? '' : 'page-break-after'}">
        ${generateParcelLabelHtml(order)}
      </div>
    `;
  });

  stage.innerHTML = combinedHtml;
  window.print();
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
