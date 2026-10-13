<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import ReceiptPreview from '@/components/sales/ReceiptPreview.vue';
import type { Product } from '@shared/contracts/products';
import type { SaleResult } from '@shared/contracts/checkout';

type CartLine = { product: Product; quantityMilli: number };
type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'mobile_wallet' | 'other';
type PaymentLine = {
  key: number;
  method: PaymentMethod;
  amount: string;
  tendered: string;
  reference: string;
};

const products = ref<Product[]>([]);
const cart = ref<CartLine[]>([]);
const search = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const loading = ref(false);
const saving = ref(false);
const paymentOpen = ref(false);
const receipt = ref<SaleResult | null>(null);
const errorMessage = ref('');
const successMessage = ref('');
const paymentLines = ref<PaymentLine[]>([]);
let paymentLineKey = 1;

const formatMoney = (minor: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
  }).format(minor / 100);
const moneyToMinor = (value: string) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round((number + Number.EPSILON) * 100) : 0;
};
const cartCount = computed(() => cart.value.reduce((sum, line) => sum + line.quantityMilli, 0));
const cartTotals = computed(() => {
  const subtotalMinor = cart.value.reduce(
    (sum, line) => sum + Math.round((line.product.sellingPriceMinor * line.quantityMilli) / 1000),
    0,
  );
  const taxMinor = cart.value.reduce((sum, line) => {
    const lineSubtotal = Math.round((line.product.sellingPriceMinor * line.quantityMilli) / 1000);
    return sum + Math.round((lineSubtotal * line.product.taxRateBasisPoints) / 10000);
  }, 0);
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
});
const paymentAppliedMinor = computed(() =>
  paymentLines.value.reduce((sum, line) => sum + moneyToMinor(line.amount), 0),
);
const paymentRemainingMinor = computed(
  () => cartTotals.value.totalMinor - paymentAppliedMinor.value,
);
const canCompletePayment = computed(
  () =>
    paymentLines.value.length > 0 &&
    paymentRemainingMinor.value === 0 &&
    paymentLines.value.every((line) => moneyToMinor(line.amount) > 0),
);

async function loadProducts() {
  loading.value = true;
  errorMessage.value = '';
  try {
    products.value = await window.nouvo.listProducts({
      search: search.value,
      includeArchived: false,
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Products could not be loaded.';
  } finally {
    loading.value = false;
  }
}

function addToCart(product: Product) {
  errorMessage.value = '';
  if (!product.isActive) return;
  const existing = cart.value.find((line) => line.product.id === product.id);
  const nextQuantity = (existing?.quantityMilli ?? 0) + 1000;
  if (nextQuantity > product.stockOnHandMilli) {
    errorMessage.value = `Not enough ${product.name} in this counter's stock.`;
    return;
  }
  if (existing) existing.quantityMilli = nextQuantity;
  else cart.value.push({ product, quantityMilli: 1000 });
}

function changeQuantity(line: CartLine, rawValue: string) {
  const quantity = Number(rawValue);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    cart.value = cart.value.filter((candidate) => candidate.product.id !== line.product.id);
    return;
  }
  const quantityMilli = Math.round(quantity * 1000);
  if (Math.abs(quantityMilli / 1000 - quantity) > 0.0000001) {
    errorMessage.value = 'Quantity supports up to three decimal places.';
    return;
  }
  if (quantityMilli > line.product.stockOnHandMilli) {
    errorMessage.value = `Available stock for ${line.product.name} is ${(line.product.stockOnHandMilli / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })}.`;
    return;
  }
  line.quantityMilli = quantityMilli;
  errorMessage.value = '';
}

function clearCart() {
  cart.value = [];
}

function handleQuantityChange(line: CartLine, event: Event) {
  changeQuantity(line, (event.target as HTMLInputElement).value);
}

function removeFromCart(productId: string) {
  cart.value = cart.value.filter((line) => line.product.id !== productId);
}

async function searchOrScan() {
  await loadProducts();
  const query = search.value.trim().toLocaleLowerCase();
  if (!query) return;
  const exactMatch = products.value.find(
    (product) =>
      product.sku?.toLocaleLowerCase() === query ||
      product.barcodes.some((barcode) => barcode.toLocaleLowerCase() === query),
  );
  if (exactMatch) {
    addToCart(exactMatch);
    search.value = '';
    await loadProducts();
    await nextTick();
    searchInput.value?.focus();
  }
}

function openPayment() {
  errorMessage.value = '';
  if (cart.value.length === 0) {
    errorMessage.value = 'Add at least one product before checkout.';
    return;
  }
  if (cart.value.some((line) => line.quantityMilli > line.product.stockOnHandMilli)) {
    errorMessage.value = 'Cart stock has changed. Refresh inventory and review the quantities.';
    return;
  }
  paymentLines.value = [
    {
      key: paymentLineKey++,
      method: 'cash',
      amount: (cartTotals.value.totalMinor / 100).toFixed(2),
      tendered: (cartTotals.value.totalMinor / 100).toFixed(2),
      reference: '',
    },
  ];
  paymentOpen.value = true;
}

function addPaymentLine() {
  paymentLines.value.push({
    key: paymentLineKey++,
    method: 'card',
    amount: '0.00',
    tendered: '0.00',
    reference: '',
  });
}

function removePaymentLine(key: number) {
  if (paymentLines.value.length > 1)
    paymentLines.value = paymentLines.value.filter((line) => line.key !== key);
}

async function completeCheckout() {
  if (!canCompletePayment.value) {
    errorMessage.value = 'Payment amounts must add up exactly to the sale total.';
    return;
  }
  saving.value = true;
  errorMessage.value = '';
  try {
    const result = await window.nouvo.completeSale({
      idempotencyKey: window.crypto.randomUUID(),
      items: cart.value.map((line) => ({
        productId: line.product.id,
        quantityMilli: line.quantityMilli,
      })),
      paymentLines: paymentLines.value.map((line) => ({
        paymentMethod: line.method,
        amountMinor: moneyToMinor(line.amount),
        ...(line.method === 'cash' ? { amountTenderedMinor: moneyToMinor(line.tendered) } : {}),
        reference: line.reference,
      })),
    });
    receipt.value = result;
    paymentOpen.value = false;
    cart.value = [];
    successMessage.value = `Sale ${result.receiptNumber} saved successfully.`;
    await loadProducts();
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : 'Sale could not be completed. Your cart has been kept.';
  } finally {
    saving.value = false;
  }
}

function closeReceipt() {
  receipt.value = null;
  nextTick(() => searchInput.value?.focus());
}

onMounted(async () => {
  await loadProducts();
  await nextTick();
  searchInput.value?.focus();
});
</script>

<template>
  <div class="checkout-page">
    <PageHeader
      eyebrow="FAST COUNTER SALES"
      title="Checkout"
      description="Scan a barcode or search products, review the cart, then take payment."
    />
    <div v-if="successMessage" class="inventory-alert inventory-alert--success" role="status">
      {{ successMessage }}
    </div>
    <div
      v-if="errorMessage && !paymentOpen"
      class="inventory-alert inventory-alert--error"
      role="alert"
    >
      {{ errorMessage }}
    </div>

    <div class="checkout-workspace">
      <section class="checkout-catalogue">
        <BaseCard :padded="false" class="checkout-catalogue-card">
          <form class="checkout-search" @submit.prevent="searchOrScan">
            <span aria-hidden="true">⌕</span>
            <input
              ref="searchInput"
              v-model="search"
              aria-label="Search or scan barcode"
              placeholder="Scan barcode or search products…"
              autocomplete="off"
            />
            <BaseButton type="submit" variant="secondary" :loading="loading">Search</BaseButton>
          </form>
          <div class="checkout-catalogue-heading">
            <div>
              <strong>Products</strong
              ><small>{{ products.length }} item{{ products.length === 1 ? '' : 's' }} found</small>
            </div>
            <button type="button" @click="loadProducts">↻ Refresh</button>
          </div>
          <div v-if="loading && products.length === 0" class="checkout-empty">
            <span class="inventory-spinner"></span><strong>Loading catalogue…</strong>
          </div>
          <div v-else-if="products.length === 0" class="checkout-empty">
            <div class="inventory-empty-icon">▤</div>
            <strong>No products found</strong>
            <p>Create a product in Inventory, then receive stock before selling it.</p>
          </div>
          <div v-else class="checkout-product-grid">
            <button
              v-for="product in products"
              :key="product.id"
              class="checkout-product-tile"
              type="button"
              :disabled="!product.isActive || product.stockOnHandMilli <= 0"
              @click="addToCart(product)"
            >
              <span class="checkout-product-symbol">{{
                product.name.slice(0, 1).toUpperCase()
              }}</span>
              <strong>{{ product.name }}</strong>
              <small>{{ product.sku || product.barcodes[0] || 'No code' }}</small>
              <span class="checkout-product-price">{{
                formatMoney(product.sellingPriceMinor)
              }}</span>
              <span
                class="checkout-product-stock"
                :class="product.stockOnHandMilli > 0 ? 'has-stock' : 'no-stock'"
                >{{
                  (product.stockOnHandMilli / 1000).toLocaleString('en-PK', {
                    maximumFractionDigits: 3,
                  })
                }}
                {{ product.baseUnit }} available</span
              >
              <span class="checkout-add-icon">＋</span>
            </button>
          </div>
        </BaseCard>
      </section>

      <aside class="checkout-cart-column">
        <BaseCard :padded="false" class="checkout-cart-card">
          <header class="checkout-cart-header">
            <div>
              <span class="page-eyebrow">CURRENT ORDER</span>
              <h2>
                Cart <span>{{ cart.length }}</span>
              </h2>
            </div>
            <button type="button" :disabled="cart.length === 0" @click="clearCart">
              Clear all
            </button>
          </header>
          <div v-if="cart.length === 0" class="checkout-cart-empty">
            <span class="checkout-cart-empty-icon">▱</span><strong>Your cart is empty</strong>
            <p>Choose products from the catalogue or scan a barcode to start an order.</p>
          </div>
          <div v-else class="checkout-cart-lines">
            <article v-for="line in cart" :key="line.product.id" class="checkout-cart-line">
              <div class="checkout-cart-line-main">
                <div>
                  <strong>{{ line.product.name }}</strong
                  ><small
                    >{{ formatMoney(line.product.sellingPriceMinor) }} /
                    {{ line.product.baseUnit }}</small
                  >
                </div>
                <button
                  type="button"
                  :aria-label="`Remove ${line.product.name}`"
                  @click="removeFromCart(line.product.id)"
                >
                  ×
                </button>
              </div>
              <div class="checkout-cart-line-bottom">
                <label
                  ><span class="sr-only">Quantity for {{ line.product.name }}</span
                  ><input
                    type="number"
                    min="0.001"
                    step="0.001"
                    :value="(line.quantityMilli / 1000).toString()"
                    @change="handleQuantityChange(line, $event)" /></label
                ><strong>{{
                  formatMoney(
                    Math.round((line.product.sellingPriceMinor * line.quantityMilli) / 1000) +
                      Math.round(
                        (Math.round((line.product.sellingPriceMinor * line.quantityMilli) / 1000) *
                          line.product.taxRateBasisPoints) /
                          10000,
                      ),
                  )
                }}</strong>
              </div>
            </article>
          </div>
          <div class="checkout-totals">
            <div>
              <span>Items quantity</span
              ><strong>{{
                (cartCount / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })
              }}</strong>
            </div>
            <div>
              <span>Subtotal</span><strong>{{ formatMoney(cartTotals.subtotalMinor) }}</strong>
            </div>
            <div>
              <span>Tax</span><strong>{{ formatMoney(cartTotals.taxMinor) }}</strong>
            </div>
            <div class="checkout-grand-total">
              <span>Total due</span><strong>{{ formatMoney(cartTotals.totalMinor) }}</strong>
            </div>
          </div>
          <div class="checkout-pay-area">
            <BaseButton block :disabled="cart.length === 0 || saving" @click="openPayment"
              >Continue to payment <span>→</span></BaseButton
            ><small
              ><span class="status-dot"></span> Sale is saved locally before success is shown</small
            >
          </div>
        </BaseCard>
      </aside>
    </div>

    <div v-if="paymentOpen" class="inventory-modal-backdrop" @click.self="paymentOpen = false">
      <section
        class="inventory-modal checkout-payment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-title"
      >
        <header class="inventory-modal-header">
          <div>
            <span class="page-eyebrow">PAYMENT DETAILS</span>
            <h2 id="payment-title">Take payment</h2>
            <p>
              Amount due: <strong>{{ formatMoney(cartTotals.totalMinor) }}</strong>
            </p>
          </div>
          <button
            type="button"
            class="inventory-modal-close"
            aria-label="Close payment"
            @click="paymentOpen = false"
          >
            ×
          </button>
        </header>
        <form class="inventory-form" @submit.prevent="completeCheckout">
          <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
            {{ errorMessage }}
          </div>
          <div v-for="line in paymentLines" :key="line.key" class="checkout-payment-line">
            <div class="checkout-payment-line-title">
              <strong>Payment {{ line.key }}</strong
              ><button
                v-if="paymentLines.length > 1"
                type="button"
                @click="removePaymentLine(line.key)"
              >
                Remove
              </button>
            </div>
            <div class="inventory-form-grid">
              <label class="inventory-field"
                >Method <span>*</span
                ><select v-model="line.method">
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="mobile_wallet">Mobile wallet</option>
                  <option value="other">Other</option>
                </select></label
              >
              <label class="inventory-field"
                >Amount applied (PKR) <span>*</span
                ><input v-model="line.amount" type="number" min="0.01" step="0.01" required
              /></label>
              <label v-if="line.method === 'cash'" class="inventory-field"
                >Cash tendered (PKR) <span>*</span
                ><input v-model="line.tendered" type="number" min="0" step="0.01" required
              /></label>
              <label class="inventory-field"
                >Reference
                <input
                  v-model="line.reference"
                  maxlength="200"
                  placeholder="Optional transaction reference"
              /></label>
            </div>
          </div>
          <button class="checkout-add-payment" type="button" @click="addPaymentLine">
            ＋ Add split payment
          </button>
          <div class="checkout-payment-summary">
            <div>
              <span>Amount applied</span><strong>{{ formatMoney(paymentAppliedMinor) }}</strong>
            </div>
            <div>
              <span>Remaining</span
              ><strong
                :class="
                  paymentRemainingMinor === 0
                    ? 'checkout-payment-balanced'
                    : 'checkout-payment-unbalanced'
                "
                >{{ formatMoney(Math.abs(paymentRemainingMinor)) }}
                {{ paymentRemainingMinor < 0 ? 'overpaid' : 'due' }}</strong
              >
            </div>
          </div>
          <footer class="inventory-modal-footer">
            <BaseButton variant="secondary" @click="paymentOpen = false">Back to cart</BaseButton
            ><BaseButton type="submit" :loading="saving" :disabled="!canCompletePayment"
              >Complete sale</BaseButton
            >
          </footer>
        </form>
      </section>
    </div>

    <ReceiptPreview v-if="receipt" :sale="receipt" done-label="New sale" @close="closeReceipt" />
  </div>
</template>
