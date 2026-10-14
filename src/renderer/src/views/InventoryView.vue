<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type { Product } from '@shared/contracts/products';
import type { BusinessSettings } from '@shared/contracts/settings';

const products = ref<Product[]>([]);
const currencyCode = ref('PKR');
const search = ref('');
const loading = ref(false);
const saving = ref(false);
const showArchived = ref(false);
const editorOpen = ref(false);
const stockEditorOpen = ref(false);
const stockProduct = ref<Product | null>(null);
const stockMovementType = ref<'receipt' | 'adjustment' | 'write_off'>('receipt');
const stockQuantity = ref('1');
const stockUnitCost = ref('0.00');
const stockReason = ref('Initial stock received');
const editingId = ref<string | null>(null);
const errorMessage = ref('');
const successMessage = ref('');
let searchDebounce: ReturnType<typeof setTimeout> | undefined;
let latestProductRequest = 0;
const form = reactive({
  name: '',
  description: '',
  categoryName: '',
  sku: '',
  barcodesText: '',
  baseUnit: 'piece',
  purchasePrice: '0.00',
  sellingPrice: '0.00',
  taxPercent: '0',
  initialStockQuantity: '0',
});

const activeCount = computed(() => products.value.filter((product) => product.isActive).length);
const formatMoney = (minor: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: currencyCode.value,
    minimumFractionDigits: 2,
  }).format(minor / 100);
const toMinor = (value: string) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 90_000_000_000)
    throw new Error('Enter a valid non-negative price.');
  return Math.round((number + Number.EPSILON) * 100);
};

async function loadProducts() {
  const requestId = ++latestProductRequest;
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await window.nouvo.listProducts({
      search: search.value.trim(),
      includeArchived: showArchived.value,
    });
    if (requestId === latestProductRequest) products.value = result;
  } catch (error) {
    if (requestId === latestProductRequest) {
      errorMessage.value = error instanceof Error ? error.message : 'Products could not be loaded.';
    }
  } finally {
    if (requestId === latestProductRequest) loading.value = false;
  }
}

function resetForm() {
  editingId.value = null;
  Object.assign(form, {
    name: '',
    description: '',
    categoryName: '',
    sku: '',
    barcodesText: '',
    baseUnit: 'piece',
    purchasePrice: '0.00',
    sellingPrice: '0.00',
    taxPercent: '0',
    initialStockQuantity: '0',
  });
  errorMessage.value = '';
}

function openNewProduct() {
  resetForm();
  editorOpen.value = true;
}

function openEditProduct(product: Product) {
  resetForm();
  editingId.value = product.id;
  Object.assign(form, {
    name: product.name,
    description: product.description,
    categoryName: product.categoryName,
    sku: product.sku ?? '',
    barcodesText: product.barcodes.join('\n'),
    baseUnit: product.baseUnit,
    purchasePrice: (product.purchaseCostMinor / 100).toFixed(2),
    sellingPrice: (product.sellingPriceMinor / 100).toFixed(2),
    taxPercent: (product.taxRateBasisPoints / 100).toString(),
    initialStockQuantity: '0',
  });
  editorOpen.value = true;
}

async function saveProduct() {
  saving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const purchaseCostMinor = toMinor(form.purchasePrice);
    const sellingPriceMinor = toMinor(form.sellingPrice);
    const taxPercent = Number(form.taxPercent);
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100)
      throw new Error('Tax rate must be between 0 and 100 percent.');

    const isEditing = Boolean(editingId.value);
    const initialQuantity = isEditing ? 0 : Number(form.initialStockQuantity);
    if (!Number.isFinite(initialQuantity) || initialQuantity < 0 || initialQuantity > 9_000_000)
      throw new Error('Initial stock must be a valid quantity of 0 or more.');
    const initialQuantityMilli = Math.round(initialQuantity * 1000);
    if (Math.abs(initialQuantityMilli / 1000 - initialQuantity) > 0.0000001)
      throw new Error('Initial stock supports up to three decimal places.');

    const barcodes = [
      ...new Set(
        form.barcodesText
          .split(/[\n,;]/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    const savedProduct = await window.nouvo.saveProduct({
      ...(editingId.value ? { id: editingId.value } : {}),
      name: form.name,
      description: form.description,
      categoryName: form.categoryName,
      sku: form.sku,
      barcodes,
      baseUnit: form.baseUnit,
      purchaseCostMinor,
      sellingPriceMinor,
      taxRateBasisPoints: Math.round(taxPercent * 100),
    });

    // Close after product creation so a stock-ledger error cannot cause duplicate products on retry.
    editorOpen.value = false;
    if (!isEditing && initialQuantityMilli > 0) {
      try {
        const result = await window.nouvo.recordStockMovement({
          productId: savedProduct.id,
          movementType: 'receipt',
          quantityMilli: initialQuantityMilli,
          unitCostMinor: purchaseCostMinor,
          reason: 'Opening stock at product creation',
        });
        successMessage.value = `Product created with opening stock: ${(result.quantityMilli / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })} ${savedProduct.baseUnit}.`;
      } catch (stockError) {
        successMessage.value = 'Product created successfully.';
        errorMessage.value =
          `Product was created, but opening stock was not saved. Use its Stock button to add it. ${stockError instanceof Error ? stockError.message : ''}`.trim();
      }
    } else {
      successMessage.value = isEditing
        ? 'Product updated successfully.'
        : 'Product created successfully.';
    }
    await loadProducts();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Product could not be saved.';
  } finally {
    saving.value = false;
  }
}

function openStockEditor(product: Product) {
  stockProduct.value = product;
  stockMovementType.value = 'receipt';
  stockQuantity.value = '1';
  stockUnitCost.value = (product.purchaseCostMinor / 100).toFixed(2);
  stockReason.value = '';
  errorMessage.value = '';
  stockEditorOpen.value = true;
}

async function saveStockMovement() {
  if (!stockProduct.value) return;
  saving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const quantity = Number(stockQuantity.value);
    if (!Number.isFinite(quantity) || quantity === 0 || Math.abs(quantity) > 9_000_000) {
      throw new Error('Enter a non-zero quantity with at most three decimal places.');
    }
    const quantityMilli = Math.round(quantity * 1000);
    if (quantityMilli === 0) throw new Error('Quantity must be at least 0.001.');
    if (Math.abs(quantityMilli / 1000 - quantity) > 0.0000001) {
      throw new Error('Quantity supports up to three decimal places.');
    }
    const unitCostMinor =
      stockMovementType.value === 'receipt' ? toMinor(stockUnitCost.value) : undefined;
    const result = await window.nouvo.recordStockMovement({
      productId: stockProduct.value.id,
      movementType: stockMovementType.value,
      quantityMilli,
      ...(unitCostMinor !== undefined ? { unitCostMinor } : {}),
      reason: stockReason.value,
    });
    stockEditorOpen.value = false;
    successMessage.value = `Stock saved. New on-hand: ${(result.quantityMilli / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })} ${stockProduct.value.baseUnit}.`;
    await loadProducts();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Stock movement could not be saved.';
  } finally {
    saving.value = false;
  }
}

async function archiveProduct(product: Product) {
  if (!window.confirm(`Archive “${product.name}”? It will remain in historical records.`)) return;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    await window.nouvo.archiveProduct(product.id, 'Archived from inventory');
    successMessage.value = `${product.name} archived.`;
    await loadProducts();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Product could not be archived.';
  }
}

watch([search, showArchived], () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => void loadProducts(), 180);
});

onMounted(async () => {
  try {
    const settings: BusinessSettings = await window.nouvo.getBusinessSettings();
    currencyCode.value = settings.currencyCode;
  } catch {
    /* product loading displays database errors */
  }
  await loadProducts();
});
</script>

<template>
  <div class="inventory-page">
    <PageHeader
      eyebrow="CATALOGUE MANAGEMENT"
      title="Inventory"
      description="Manage products, prices and barcodes. Changes are saved locally on this counter."
    >
      <template #actions>
        <BaseButton @click="openNewProduct">＋ Add product</BaseButton>
      </template>
    </PageHeader>

    <div v-if="successMessage" class="inventory-alert inventory-alert--success" role="status">
      {{ successMessage }}
    </div>
    <div
      v-if="errorMessage && !editorOpen"
      class="inventory-alert inventory-alert--error"
      role="alert"
    >
      {{ errorMessage }}
    </div>

    <div class="inventory-stats">
      <BaseCard>
        <span class="inventory-stat-label">{{
          showArchived ? 'Products shown' : 'Active products'
        }}</span
        ><strong>{{ products.length }}</strong
        ><small>{{ showArchived ? 'Including archived items' : 'Ready for catalogue use' }}</small>
      </BaseCard>
      <BaseCard>
        <span class="inventory-stat-label">Active in current results</span
        ><strong>{{ activeCount }}</strong
        ><small>Filtered by your search</small>
      </BaseCard>
      <BaseCard>
        <span class="inventory-stat-label">Storage status</span
        ><strong class="inventory-storage-status">Local · Saved</strong
        ><small>Offline-ready database</small>
      </BaseCard>
    </div>

    <BaseCard class="inventory-table-card" :padded="false">
      <div class="inventory-toolbar">
        <form class="inventory-search" @submit.prevent="loadProducts">
          <label class="sr-only" for="product-search">Search products</label>
          <span aria-hidden="true">⌕</span>
          <input
            id="product-search"
            v-model="search"
            placeholder="Type a product name, SKU or barcode…"
          />
          <BaseButton type="submit" variant="secondary" :loading="loading">Search</BaseButton>
        </form>
        <label class="inventory-archived-toggle"
          ><input v-model="showArchived" type="checkbox" /> Include archived</label
        >
      </div>

      <div v-if="loading" class="inventory-empty">
        <span class="inventory-spinner"></span><strong>Loading products…</strong>
      </div>
      <div v-else-if="products.length === 0" class="inventory-empty">
        <div class="inventory-empty-icon">▤</div>
        <strong>{{ search ? 'No matching products' : 'Your catalogue starts here' }}</strong>
        <p>
          {{
            search
              ? 'Try another product name, SKU or barcode.'
              : 'Add your first product to start building your inventory catalogue.'
          }}
        </p>
        <BaseButton v-if="!search" @click="openNewProduct">Add your first product</BaseButton>
      </div>
      <div v-else class="inventory-table-wrap">
        <table class="inventory-table inventory-products-table">
          <thead>
            <tr>
              <th>PRODUCT</th>
              <th>SKU / BARCODE</th>
              <th>CATEGORY</th>
              <th>STOCK ON HAND</th>
              <th>PURCHASE COST</th>
              <th>SELLING PRICE</th>
              <th>STATUS</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="product in products" :key="product.id">
              <td>
                <div class="inventory-product-name">
                  <span class="inventory-product-avatar">{{
                    product.name.slice(0, 1).toUpperCase()
                  }}</span
                  ><span
                    ><strong>{{ product.name }}</strong
                    ><small>{{ product.baseUnit }}</small></span
                  >
                </div>
              </td>
              <td>
                <span class="inventory-code">{{ product.sku || '—' }}</span
                ><small class="inventory-barcode">{{ product.barcodes[0] || 'No barcode' }}</small>
              </td>
              <td>{{ product.categoryName || 'Uncategorized' }}</td>
              <td>
                <span class="inventory-stock-quantity">{{
                  (product.stockOnHandMilli / 1000).toLocaleString('en-PK', {
                    maximumFractionDigits: 3,
                  })
                }}</span>
                <small>{{ product.baseUnit }}</small>
              </td>
              <td>{{ formatMoney(product.purchaseCostMinor) }}</td>
              <td class="inventory-price">{{ formatMoney(product.sellingPriceMinor) }}</td>
              <td>
                <span
                  class="inventory-status"
                  :class="
                    product.isActive ? 'inventory-status--active' : 'inventory-status--archived'
                  "
                  >{{ product.isActive ? 'Active' : 'Archived' }}</span
                >
              </td>
              <td>
                <div class="inventory-row-actions">
                  <button
                    v-if="product.isActive"
                    class="inventory-text-action"
                    type="button"
                    @click="openStockEditor(product)"
                  >
                    Stock
                  </button>
                  <button
                    class="inventory-text-action"
                    type="button"
                    @click="openEditProduct(product)"
                  >
                    Edit</button
                  ><button
                    v-if="product.isActive"
                    class="inventory-text-action inventory-text-action--danger"
                    type="button"
                    @click="archiveProduct(product)"
                  >
                    Archive
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="inventory-table-footer">
        <span
          >Showing {{ products.length }} product{{ products.length === 1 ? '' : 's' }} · Maximum
          1,000 per result</span
        ><button type="button" @click="loadProducts">↻ Refresh</button>
      </div>
    </BaseCard>

    <div v-if="editorOpen" class="inventory-modal-backdrop" @click.self="editorOpen = false">
      <section
        class="inventory-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="'product-editor-title'"
      >
        <header class="inventory-modal-header">
          <div>
            <span class="page-eyebrow">PRODUCT DETAILS</span>
            <h2 id="product-editor-title">{{ editingId ? 'Edit product' : 'Add product' }}</h2>
            <p>Prices are stored as integer minor units to avoid floating-point errors.</p>
          </div>
          <button
            type="button"
            class="inventory-modal-close"
            aria-label="Close editor"
            @click="editorOpen = false"
          >
            ×
          </button>
        </header>
        <form class="inventory-form" @submit.prevent="saveProduct">
          <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
            {{ errorMessage }}
          </div>
          <label class="inventory-field inventory-field--wide"
            >Product name <span>*</span
            ><input
              v-model="form.name"
              required
              maxlength="180"
              autofocus
              placeholder="e.g. Basmati Rice 5kg"
          /></label>
          <div class="inventory-form-grid">
            <label class="inventory-field"
              >SKU / Internal code<input
                v-model="form.sku"
                maxlength="80"
                placeholder="Optional unique code"
            /></label>
            <label class="inventory-field"
              >Category<input
                v-model="form.categoryName"
                maxlength="100"
                placeholder="e.g. Grocery"
            /></label>
            <label class="inventory-field"
              >Base unit <span>*</span
              ><input v-model="form.baseUnit" required maxlength="32" placeholder="piece, kg, pack"
            /></label>
            <label class="inventory-field"
              >Tax rate (%)<input
                v-model="form.taxPercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
            /></label>
            <label class="inventory-field"
              >Purchase cost (PKR) <span>*</span
              ><input v-model="form.purchasePrice" type="number" min="0" step="0.01" required
            /></label>
            <label class="inventory-field"
              >Selling price (PKR) <span>*</span
              ><input v-model="form.sellingPrice" type="number" min="0" step="0.01" required
            /></label>
            <label v-if="!editingId" class="inventory-field inventory-field--wide"
              >Initial stock quantity
              <input
                v-model="form.initialStockQuantity"
                type="number"
                min="0"
                max="9000000"
                step="0.001"
                inputmode="decimal"
                placeholder="0"
              />
              <small
                >Optional. Leave at 0 if you will add stock later. Opening stock uses the purchase
                cost above and is recorded in the stock ledger.</small
              >
            </label>
          </div>
          <label class="inventory-field inventory-field--wide"
            >Barcodes <small>One per line; duplicate barcodes are rejected.</small
            ><textarea
              v-model="form.barcodesText"
              rows="3"
              placeholder="Scan or type barcode values"
            />
          </label>
          <label class="inventory-field inventory-field--wide"
            >Description<textarea
              v-model="form.description"
              rows="2"
              maxlength="2000"
              placeholder="Optional product details"
            />
          </label>
          <footer class="inventory-modal-footer">
            <BaseButton variant="secondary" @click="editorOpen = false">Cancel</BaseButton
            ><BaseButton type="submit" :loading="saving">
              {{ editingId ? 'Save changes' : 'Create product' }}
            </BaseButton>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-if="stockEditorOpen && stockProduct"
      class="inventory-modal-backdrop"
      @click.self="stockEditorOpen = false"
    >
      <section
        class="inventory-modal inventory-stock-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-editor-title"
      >
        <header class="inventory-modal-header">
          <div>
            <span class="page-eyebrow">STOCK LEDGER</span>
            <h2 id="stock-editor-title">Update stock</h2>
            <p>
              {{ stockProduct.name }} · Current on-hand:
              {{
                (stockProduct.stockOnHandMilli / 1000).toLocaleString('en-PK', {
                  maximumFractionDigits: 3,
                })
              }}
              {{ stockProduct.baseUnit }}
            </p>
          </div>
          <button
            type="button"
            class="inventory-modal-close"
            aria-label="Close stock editor"
            @click="stockEditorOpen = false"
          >
            ×
          </button>
        </header>
        <form class="inventory-form" @submit.prevent="saveStockMovement">
          <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
            {{ errorMessage }}
          </div>
          <label class="inventory-field"
            >Movement type <span>*</span
            ><select v-model="stockMovementType">
              <option value="receipt">Receive stock</option>
              <option value="adjustment">Stock adjustment</option>
              <option value="write_off">Write-off / damaged</option>
            </select></label
          >
          <label class="inventory-field"
            >{{ stockMovementType === 'adjustment' ? 'Quantity change (+/-)' : 'Quantity' }}
            <span>*</span
            ><input
              v-model="stockQuantity"
              type="number"
              :min="stockMovementType === 'adjustment' ? undefined : '0.001'"
              :step="0.001"
              required
          /></label>
          <label v-if="stockMovementType === 'receipt'" class="inventory-field"
            >Unit purchase cost (PKR)<input
              v-model="stockUnitCost"
              type="number"
              min="0"
              step="0.01"
              required
          /></label>
          <label class="inventory-field"
            >Reason / reference <span>*</span
            ><textarea
              v-model="stockReason"
              rows="2"
              minlength="3"
              maxlength="500"
              required
              placeholder="Supplier delivery, stock count correction, damage…"
            />
          </label>
          <p class="inventory-stock-note">
            Every movement is recorded in the stock ledger and audit log. Negative on-hand stock is
            blocked. Adjustments require a reason.
          </p>
          <footer class="inventory-modal-footer">
            <BaseButton variant="secondary" @click="stockEditorOpen = false">Cancel</BaseButton
            ><BaseButton type="submit" :loading="saving">Save stock movement</BaseButton>
          </footer>
        </form>
      </section>
    </div>
  </div>
</template>
