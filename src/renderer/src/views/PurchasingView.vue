<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type { Product } from '@shared/contracts/products';
import type {
  PurchaseOrderInput,
  PurchaseOrderSummary,
  Supplier,
} from '@shared/contracts/purchasing';

const suppliers = ref<Supplier[]>([]);
const products = ref<Product[]>([]);
const orders = ref<PurchaseOrderSummary[]>([]);
const currencyCode = ref('PKR');
const loading = ref(false);
const busy = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const supplierForm = reactive({ name: '', phone: '', email: '', address: '', taxNumber: '' });
const orderForm = reactive({
  supplierId: '',
  notes: '',
  lines: [{ productId: '', quantity: '1', unitCost: '' }],
});
const money = (minor: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode.value,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
const orderTotal = computed(() =>
  orderForm.lines.reduce(
    (sum, line) =>
      sum + Math.round((Number(line.quantity) || 0) * (Number(line.unitCost) || 0) * 100),
    0,
  ),
);

async function refresh() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [supplierRows, productRows, orderRows, settings] = await Promise.all([
      window.nouvo.listSuppliers(),
      window.nouvo.listProducts({ includeArchived: false }),
      window.nouvo.listPurchaseOrders(),
      window.nouvo.getBusinessSettings(),
    ]);
    suppliers.value = supplierRows;
    products.value = productRows.filter((product) => product.isActive);
    orders.value = orderRows;
    currencyCode.value = settings.currencyCode;
    if (!orderForm.supplierId && suppliers.value.length)
      orderForm.supplierId = suppliers.value[0].id;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Purchasing data could not be loaded.';
  } finally {
    loading.value = false;
  }
}

async function saveSupplier() {
  busy.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const supplier = await window.nouvo.saveSupplier({ ...supplierForm });
    Object.assign(supplierForm, { name: '', phone: '', email: '', address: '', taxNumber: '' });
    await refresh();
    orderForm.supplierId = supplier.id;
    successMessage.value = `${supplier.name} was saved as a supplier.`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Supplier could not be saved.';
  } finally {
    busy.value = false;
  }
}
function addLine() {
  if (orderForm.lines.length < 20)
    orderForm.lines.push({ productId: '', quantity: '1', unitCost: '' });
}
function removeLine(index: number) {
  if (orderForm.lines.length > 1) orderForm.lines.splice(index, 1);
}
async function createOrder() {
  busy.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const input: PurchaseOrderInput = {
      supplierId: orderForm.supplierId,
      notes: orderForm.notes,
      lines: orderForm.lines.map((line) => ({
        productId: line.productId,
        quantityMilli: Math.round(Number(line.quantity) * 1000),
        unitCostMinor: Math.round(Number(line.unitCost) * 100),
      })),
    };
    const order = await window.nouvo.createPurchaseOrder(input);
    orderForm.notes = '';
    orderForm.lines = [{ productId: '', quantity: '1', unitCost: '' }];
    await refresh();
    successMessage.value = `Purchase order ${order.orderNumber} was created. Receive goods when they arrive to update stock.`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Purchase order could not be created.';
  } finally {
    busy.value = false;
  }
}
async function receiveOrder(order: PurchaseOrderSummary) {
  const supplierInvoiceNumber = window.prompt(
    `Supplier invoice number for ${order.orderNumber} (optional):`,
    order.supplierInvoiceNumber,
  );
  if (supplierInvoiceNumber === null) return;
  if (
    !window.confirm(
      `Receive all ${order.lineCount} line(s) from ${order.orderNumber}? This will increase stock and update weighted-average purchase cost.`,
    )
  )
    return;
  busy.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const received = await window.nouvo.receivePurchaseOrder({
      id: order.id,
      supplierInvoiceNumber,
    });
    await refresh();
    successMessage.value = `${received.orderNumber} received. Stock ledger and purchase costs updated.`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Purchase order could not be received.';
  } finally {
    busy.value = false;
  }
}
async function cancelOrder(order: PurchaseOrderSummary) {
  if (!window.confirm(`Cancel draft purchase order ${order.orderNumber}?`)) return;
  busy.value = true;
  errorMessage.value = '';
  try {
    await window.nouvo.cancelPurchaseOrder(order.id);
    await refresh();
    successMessage.value = `${order.orderNumber} cancelled.`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Purchase order could not be cancelled.';
  } finally {
    busy.value = false;
  }
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
onMounted(refresh);
</script>

<template>
  <div class="purchasing-page">
    <PageHeader
      eyebrow="SUPPLIERS & STOCK RECEIVING"
      title="Purchasing"
      description="Maintain supplier details, draft purchase orders and receive goods into this counter's stock ledger."
    />
    <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
      {{ errorMessage }}
    </div>
    <div v-if="successMessage" class="inventory-alert inventory-alert--success" role="status">
      {{ successMessage }}
    </div>
    <section class="purchasing-setup-grid">
      <BaseCard class="purchasing-card">
        <header class="purchasing-card-heading">
          <div>
            <h2>Supplier directory</h2>
            <p>Add a supplier before creating an order.</p>
          </div>
          <span>{{ suppliers.length }} active</span>
        </header>
        <div class="purchasing-form-grid">
          <label class="inventory-field"
            >Supplier name <span>*</span
            ><input
              v-model="supplierForm.name"
              required
              maxlength="180"
              placeholder="Company or supplier name"
          /></label>
          <label class="inventory-field"
            >Phone<input v-model="supplierForm.phone" maxlength="80" placeholder="Contact number"
          /></label>
          <label class="inventory-field"
            >Email<input
              v-model="supplierForm.email"
              type="email"
              maxlength="160"
              placeholder="accounts@supplier.com"
          /></label>
          <label class="inventory-field"
            >Tax / registration no.<input
              v-model="supplierForm.taxNumber"
              maxlength="100"
              placeholder="Optional"
          /></label>
          <label class="inventory-field purchasing-field-wide"
            >Address<input
              v-model="supplierForm.address"
              maxlength="500"
              placeholder="Supplier address"
          /></label>
          <BaseButton type="button" :loading="busy" @click="saveSupplier">Save supplier</BaseButton>
        </div>
        <div class="purchasing-supplier-list">
          <div v-for="supplier in suppliers" :key="supplier.id">
            <span class="purchasing-supplier-avatar">{{
              supplier.name.slice(0, 1).toUpperCase()
            }}</span>
            <div>
              <strong>{{ supplier.name }}</strong
              ><small>{{ supplier.phone || supplier.email || 'No contact details' }}</small>
            </div>
          </div>
          <p v-if="!suppliers.length" class="purchasing-empty">
            No suppliers yet. Add the first supplier above.
          </p>
        </div>
      </BaseCard>
      <BaseCard class="purchasing-card">
        <header class="purchasing-card-heading">
          <div>
            <h2>New purchase order</h2>
            <p>Draft an order; stock changes only when goods are received.</p>
          </div>
        </header>
        <div v-if="!suppliers.length" class="purchasing-notice">
          Create a supplier first to enable purchase orders.
        </div>
        <div class="purchasing-form-grid">
          <label class="inventory-field purchasing-field-wide"
            >Supplier <span>*</span
            ><select v-model="orderForm.supplierId" :disabled="!suppliers.length">
              <option value="" disabled>Select supplier</option>
              <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">
                {{ supplier.name }}
              </option>
            </select></label
          >
          <label class="inventory-field purchasing-field-wide"
            >Notes<textarea
              v-model="orderForm.notes"
              maxlength="1000"
              rows="2"
              placeholder="Delivery notes or terms (optional)"
            />
          </label>
        </div>
        <div class="purchasing-lines-heading">
          <strong>Order lines</strong
          ><button type="button" :disabled="orderForm.lines.length >= 20" @click="addLine">
            + Add product
          </button>
        </div>
        <div v-for="(line, index) in orderForm.lines" :key="index" class="purchasing-order-line">
          <label class="inventory-field purchasing-product-field"
            >Product<select v-model="line.productId" required>
              <option value="" disabled>Select product</option>
              <option v-for="product in products" :key="product.id" :value="product.id">
                {{ product.name }}{{ product.sku ? ` · ${product.sku}` : '' }}
              </option>
            </select></label
          >
          <label class="inventory-field"
            >Qty<input v-model="line.quantity" type="number" min="0.001" step="0.001" required
          /></label>
          <label class="inventory-field"
            >Unit cost ({{ currencyCode }})<input
              v-model="line.unitCost"
              type="number"
              min="0"
              step="0.01"
              required
          /></label>
          <button
            v-if="orderForm.lines.length > 1"
            class="purchasing-remove-line"
            type="button"
            aria-label="Remove order line"
            @click="removeLine(index)"
          >
            ×
          </button>
        </div>
        <div class="purchasing-order-total">
          <span>Estimated order total</span><strong>{{ money(orderTotal) }}</strong>
        </div>
        <div class="purchasing-create-action">
          <BaseButton
            type="button"
            :loading="busy"
            :disabled="!suppliers.length || !products.length"
            @click="createOrder"
            >Create draft order</BaseButton
          >
        </div>
      </BaseCard>
    </section>
    <BaseCard class="purchasing-orders-card">
      <header class="purchasing-card-heading">
        <div>
          <h2>Purchase order history</h2>
          <p>Receiving posts stock movements atomically and records audit/outbox events.</p>
        </div>
        <span>{{ orders.length }} orders</span>
      </header>
      <div v-if="loading && !orders.length" class="purchasing-empty">Loading orders…</div>
      <div v-else-if="!orders.length" class="purchasing-empty">
        No purchase orders yet. Create a draft order above.
      </div>
      <div v-else class="reports-table-wrap">
        <table class="inventory-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Supplier</th>
              <th>Items</th>
              <th>Total</th>
              <th>Created</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in orders" :key="order.id">
              <td>
                <strong>{{ order.orderNumber }}</strong
                ><small v-if="order.supplierInvoiceNumber" class="purchasing-invoice"
                  >Invoice: {{ order.supplierInvoiceNumber }}</small
                >
              </td>
              <td>{{ order.supplierName }}</td>
              <td>{{ order.lineCount }}</td>
              <td>{{ money(order.subtotalMinor) }}</td>
              <td>{{ formatDate(order.orderedAt) }}</td>
              <td>
                <span class="purchasing-status" :class="`purchasing-status--${order.status}`">{{
                  order.status
                }}</span>
              </td>
              <td>
                <div class="settings-user-actions">
                  <button
                    v-if="order.status === 'draft'"
                    type="button"
                    :disabled="busy"
                    @click="receiveOrder(order)"
                  >
                    Receive goods</button
                  ><button
                    v-if="order.status === 'draft'"
                    type="button"
                    :disabled="busy"
                    @click="cancelOrder(order)"
                  >
                    Cancel
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </BaseCard>
    <p class="reports-disclaimer">
      Receiving uses moving weighted-average purchase cost for the local counter and records
      supplier invoice metadata. Supplier balances, purchase returns, posted accounting journals and
      central sync are not yet implemented.
    </p>
  </div>
</template>
