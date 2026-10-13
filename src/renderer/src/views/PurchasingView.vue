<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type { Product } from '@shared/contracts/products';
import type {
  PurchaseOrderInput,
  PurchaseOrderSummary,
  PurchaseReturnableLine,
  PurchaseReturnSummary,
  Supplier,
} from '@shared/contracts/purchasing';

const suppliers = ref<Supplier[]>([]);
const products = ref<Product[]>([]);
const orders = ref<PurchaseOrderSummary[]>([]);
const purchaseReturns = ref<PurchaseReturnSummary[]>([]);
const returnOrder = ref<PurchaseOrderSummary | null>(null);
const returnLines = ref<Array<PurchaseReturnableLine & { quantity: string }>>([]);
const returnReason = ref('');
const canReturnPurchases = ref(false);
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
    const [supplierRows, productRows, orderRows, returnRows, settings] = await Promise.all([
      window.nouvo.listSuppliers(),
      window.nouvo.listProducts({ includeArchived: false }),
      window.nouvo.listPurchaseOrders(),
      window.nouvo.listPurchaseReturns(),
      window.nouvo.getBusinessSettings(),
    ]);
    suppliers.value = supplierRows;
    products.value = productRows.filter((product) => product.isActive);
    orders.value = orderRows;
    purchaseReturns.value = returnRows;
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
async function openReturn(order: PurchaseOrderSummary): Promise<void> {
  busy.value = true;
  errorMessage.value = '';
  try {
    const lines = await window.nouvo.listReturnablePurchaseOrderLines(order.id);
    if (!lines.some((line) => line.returnableQuantityMilli > 0)) {
      errorMessage.value = 'No stock from this purchase order is currently eligible to return.';
      return;
    }
    returnOrder.value = order;
    returnReason.value = '';
    returnLines.value = lines.map((line) => ({ ...line, quantity: '' }));
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Returnable quantities could not be loaded.';
  } finally {
    busy.value = false;
  }
}
async function submitPurchaseReturn(): Promise<void> {
  if (!returnOrder.value || busy.value) return;
  const lines = returnLines.value
    .filter((line) => Number(line.quantity) > 0)
    .map((line) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      quantityMilli: Math.round(Number(line.quantity) * 1000),
    }));
  if (returnReason.value.trim().length < 3 || !lines.length) {
    errorMessage.value = 'Enter a reason and at least one quantity to return.';
    return;
  }
  busy.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const result = await window.nouvo.createPurchaseReturn({
      purchaseOrderId: returnOrder.value.id,
      reason: returnReason.value.trim(),
      lines,
    });
    returnOrder.value = null;
    returnLines.value = [];
    await refresh();
    successMessage.value = `Supplier return ${result.returnNumber} posted for ${money(result.totalMinor)}.`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Supplier return could not be posted.';
  } finally {
    busy.value = false;
  }
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
onMounted(async () => {
  await refresh();
  try {
    const authState = await window.nouvo.getAuthState();
    canReturnPurchases.value = authState.permissions.includes('purchasing.return');
  } catch {
    canReturnPurchases.value = false;
  }
});
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
                    Cancel</button
                  ><button
                    v-if="order.status === 'received' && canReturnPurchases"
                    type="button"
                    :disabled="busy"
                    @click="openReturn(order)"
                  >
                    Return goods
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </BaseCard>
    <BaseCard v-if="purchaseReturns.length" class="purchasing-orders-card">
      <header class="purchasing-card-heading">
        <div>
          <h2>Supplier return history</h2>
          <p>Posted returns reduce stock and create audit, sync and accounting records.</p>
        </div>
        <span>{{ purchaseReturns.length }} returns</span>
      </header>
      <div class="reports-table-wrap">
        <table class="inventory-table">
          <thead>
            <tr>
              <th>Return</th>
              <th>Purchase order</th>
              <th>Supplier</th>
              <th>Reason</th>
              <th>Value</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="purchaseReturn in purchaseReturns" :key="purchaseReturn.id">
              <td>
                <strong>{{ purchaseReturn.returnNumber }}</strong>
              </td>
              <td>{{ purchaseReturn.orderNumber }}</td>
              <td>{{ purchaseReturn.supplierName }}</td>
              <td>{{ purchaseReturn.reason }}</td>
              <td>{{ money(purchaseReturn.totalMinor) }}</td>
              <td>{{ formatDate(purchaseReturn.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </BaseCard>
    <div v-if="returnOrder" class="purchasing-modal-backdrop" role="presentation">
      <section
        class="purchasing-return-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-return-title"
      >
        <header class="purchasing-card-heading">
          <div>
            <h2 id="purchase-return-title">Return goods · {{ returnOrder.orderNumber }}</h2>
            <p>
              {{ returnOrder.supplierName }} · only received quantity still in stock can be
              returned.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close return dialog"
            :disabled="busy"
            @click="returnOrder = null"
          >
            ×
          </button>
        </header>
        <label class="inventory-field"
          >Reason for return <span>*</span
          ><textarea
            v-model.trim="returnReason"
            maxlength="500"
            rows="2"
            placeholder="Damaged goods, expiry, supplier correction…"
          />
        </label>
        <div class="reports-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Received</th>
                <th>Returned</th>
                <th>Available to return</th>
                <th>Return qty</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in returnLines" :key="line.purchaseOrderLineId">
                <td>
                  {{ line.productName }}<small v-if="line.sku">{{ line.sku }}</small>
                </td>
                <td>{{ (line.quantityReceivedMilli / 1000).toFixed(3) }}</td>
                <td>{{ (line.quantityReturnedMilli / 1000).toFixed(3) }}</td>
                <td>{{ (line.returnableQuantityMilli / 1000).toFixed(3) }}</td>
                <td>
                  <input
                    v-model="line.quantity"
                    type="number"
                    min="0"
                    :max="line.returnableQuantityMilli / 1000"
                    step="0.001"
                    :disabled="line.returnableQuantityMilli === 0 || busy"
                    :aria-label="'Return quantity for ' + line.productName"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="purchasing-return-actions">
          <button type="button" :disabled="busy" @click="returnOrder = null">Cancel</button
          ><BaseButton type="button" :loading="busy" @click="submitPurchaseReturn"
            >Post supplier return</BaseButton
          >
        </div>
      </section>
    </div>
    <p class="reports-disclaimer">
      Receiving uses moving weighted-average purchase cost. Supplier returns now reduce local stock
      atomically, retain audit/outbox history and post a balanced accounts-payable/inventory journal
      when the return has value. Supplier payments and aging are still outstanding.
    </p>
  </div>
</template>
