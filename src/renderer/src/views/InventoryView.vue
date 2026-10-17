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
const adjustmentDirection = ref<'add' | 'remove'>('add');
const stockQuantity = ref('1');
const stockUnit = ref<'pack' | 'single'>('pack');
const stockUnitCost = ref('0.00');
const stockReason = ref('Initial stock received');
const editingId = ref<string | null>(null);
const productMode = ref<'unit' | 'pack'>('unit');
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
  packSize: '1',
  singleUnitName: 'unit',
  singleSellingPrice: '',
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
const pluralizeUnit = (unit: string) => {
  if (/(s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  return `${unit}s`;
};
const formatStock = (product: Product, quantityMilli = product.stockOnHandMilli) => {
  if (product.packSize <= 1)
    return `${(quantityMilli / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })} ${product.baseUnit}`;
  const packs = Math.floor(quantityMilli / 1000);
  const singles = Math.round(((quantityMilli - packs * 1000) * product.packSize) / 1000);
  const unitLabel = singles === 1 ? product.singleUnitName : pluralizeUnit(product.singleUnitName);
  return `${packs} pack${packs === 1 ? '' : 's'}${singles ? ` + ${singles} ${unitLabel}` : ''}`;
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
  productMode.value = 'unit';
  Object.assign(form, {
    name: '',
    description: '',
    categoryName: '',
    sku: '',
    barcodesText: '',
    baseUnit: 'piece',
    packSize: '1',
    singleUnitName: 'unit',
    singleSellingPrice: '',
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
  productMode.value = product.packSize > 1 ? 'pack' : 'unit';
  Object.assign(form, {
    name: product.name,
    description: product.description,
    categoryName: product.categoryName,
    sku: product.sku ?? '',
    barcodesText: product.barcodes.join('\n'),
    baseUnit: product.baseUnit,
    packSize: String(product.packSize),
    singleUnitName: product.singleUnitName,
    singleSellingPrice:
      product.singleSellingPriceMinor === null
        ? ''
        : (product.singleSellingPriceMinor / 100).toFixed(2),
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
    const packSize = productMode.value === 'pack' ? Number(form.packSize) : 1;
    if (!Number.isInteger(packSize) || packSize < 1 || packSize > 1000 || 1000 % packSize !== 0) {
      throw new Error(
        'Pack size must be a whole number that divides 1,000 (for example 10, 20, 25 or 50) so single-unit stock remains exact.',
      );
    }
    const singleSellingPriceMinor =
      productMode.value !== 'pack' || String(form.singleSellingPrice ?? '').trim() === ''
        ? null
        : toMinor(String(form.singleSellingPrice));
    if (singleSellingPriceMinor !== null && packSize < 2)
      throw new Error('Pack size must be greater than 1 to set a single-unit price.');
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
      packSize,
      singleUnitName: form.singleUnitName.trim() || 'unit',
      singleSellingPriceMinor,
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
  adjustmentDirection.value = 'add';
  stockUnit.value = 'pack';
  stockQuantity.value = '1';
  stockUnitCost.value = (product.purchaseCostMinor / 100).toFixed(2);
  stockReason.value = '';
  errorMessage.value = '';
  successMessage.value = '';
  stockEditorOpen.value = true;
}

async function saveStockMovement() {
  if (!stockProduct.value) return;
  saving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const quantity = Number(stockQuantity.value);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 9_000_000) {
      throw new Error(
        'Enter a quantity greater than zero with at most three decimal places. Use the Add or Remove control for stock adjustments.',
      );
    }
    if (
      stockUnit.value === 'single' &&
      (!Number.isInteger(quantity) || stockProduct.value.packSize < 2)
    ) {
      throw new Error(
        `Single-unit stock adjustments must use a whole number of ${stockProduct.value.singleUnitName}s.`,
      );
    }
    if (stockUnit.value === 'single' && 1000 % stockProduct.value.packSize !== 0) {
      throw new Error(
        'This pack size cannot be converted to exact single-unit stock with the current stock precision.',
      );
    }
    const absoluteQuantityMilli =
      stockUnit.value === 'single'
        ? Math.round((quantity * 1000) / stockProduct.value.packSize)
        : Math.round(quantity * 1000);
    const quantityMilli =
      stockMovementType.value === 'adjustment' && adjustmentDirection.value === 'remove'
        ? -absoluteQuantityMilli
        : absoluteQuantityMilli;
    if (absoluteQuantityMilli === 0) throw new Error('Quantity is too small to record.');
    if (
      stockUnit.value === 'pack' &&
      Math.abs(absoluteQuantityMilli / 1000 - quantity) > 0.0000001
    ) {
      throw new Error('Pack quantity supports up to three decimal places.');
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
    successMessage.value = `Stock saved. New on-hand: ${formatStock(stockProduct.value, result.quantityMilli)}.`;
    await loadProducts();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Stock movement could not be saved.';
  } finally {
    saving.value = false;
  }
}

async function deleteProduct(product: Product) {
  if (
    !window.confirm(
      `Permanently delete “${product.name}” only if it has no stock or business history? If it has history, the system will block deletion and you can archive it instead.`,
    )
  )
    return;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    await window.nouvo.deleteProduct(product.id, 'Permanent deletion requested from inventory');
    successMessage.value = `${product.name} permanently deleted.`;
    await loadProducts();
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : 'Product could not be deleted; archive it if it has history.';
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

watch(productMode, (value) => {
  if (value === 'unit') {
    form.packSize = '1';
    form.singleSellingPrice = '';
  } else {
    if (Number(form.packSize) < 2) form.packSize = '20';
    if (!form.baseUnit.trim() || form.baseUnit === 'piece') form.baseUnit = 'pack';
    if (!form.singleUnitName.trim() || form.singleUnitName === 'unit')
      form.singleUnitName = 'piece';
  }
});

watch(
  () => form.packSize,
  (value) => {
    if (productMode.value === 'pack' && Number(value) === 1) {
      form.singleUnitName = 'unit';
      form.singleSellingPrice = '';
    }
  },
);

watch(stockMovementType, (value) => {
  if (value === 'receipt') stockUnit.value = 'pack';
});

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
                <span class="inventory-stock-quantity">{{ formatStock(product) }}</span>
                <small v-if="product.packSize > 1">{{ product.packSize }} per pack</small>
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
                    Archive</button
                  ><button
                    class="inventory-text-action inventory-text-action--danger"
                    type="button"
                    @click="deleteProduct(product)"
                  >
                    Delete
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
          <div class="inventory-form-grid">
            <div class="inventory-section-heading">PRODUCT IDENTIFICATION</div>
            <label class="inventory-field"
              ><span class="inventory-field-label">Product name <b>*</b></span
              ><input
                v-model="form.name"
                required
                maxlength="180"
                autofocus
                placeholder="e.g. Basmati Rice 5kg"
            /></label>
            <label class="inventory-field"
              ><span class="inventory-field-label">Barcode</span
              ><textarea
                v-model="form.barcodesText"
                rows="1"
                placeholder="Scan or type barcode"
              /><small>One per line; duplicate barcodes are rejected.</small></label
            >
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
            <div class="inventory-section-heading">STOCK UNIT SETUP</div>
            <label class="inventory-field inventory-field--wide"
              ><span class="inventory-field-label">Stock setup <b>*</b></span
              ><select v-model="productMode" aria-label="Stock setup">
                <option value="unit">Single unit only</option>
                <option value="pack">Pack and individual unit</option></select
              ><small
                >Choose whether this product is tracked only as one item type, or can also be sold
                as individual units from a pack.</small
              ></label
            >
            <label class="inventory-field"
              ><span class="inventory-field-label"
                >{{ productMode === 'pack' ? 'Pack unit name' : 'Stock unit name' }} <b>*</b></span
              ><input
                v-model="form.baseUnit"
                required
                maxlength="32"
                :placeholder="
                  productMode === 'pack' ? 'e.g. pack, carton' : 'e.g. packet, bottle, piece'
                "
            /></label>
            <label v-if="productMode === 'pack'" class="inventory-field"
              >Name of one unit<input
                v-model="form.singleUnitName"
                maxlength="32"
                placeholder="e.g. cigarette, tablet, piece"
                :disabled="Number(form.packSize) < 2"
              /><small>Used for individual sales and stock adjustments.</small></label
            >
            <label v-if="productMode === 'pack'" class="inventory-field"
              ><span class="inventory-field-label">Units per pack <b>*</b></span
              ><input
                v-model="form.packSize"
                type="number"
                min="1"
                max="1000"
                step="1"
                placeholder="0"
                required
              /><small>Use 1 for ordinary products; use 20 for a pack of 20 units.</small></label
            >
            <label v-if="productMode === 'pack'" class="inventory-field"
              >Single-unit selling price (PKR)<input
                v-model="form.singleSellingPrice"
                type="number"
                min="0"
                step="0.01"
                placeholder="Leave blank until ready"
                :disabled="Number(form.packSize) < 2"
              /><small>Optional. Can be set or changed later.</small></label
            >
            <div class="inventory-section-heading">PRICING & TAX</div>
            <label class="inventory-field"
              ><span class="inventory-field-label">Tax rate (%) <b>*</b></span
              ><input
                v-model="form.taxPercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
            /></label>
            <label class="inventory-field"
              ><span class="inventory-field-label"
                >{{
                  productMode === 'pack'
                    ? 'Purchase cost per pack (PKR)'
                    : 'Purchase cost per unit (PKR)'
                }}
                <b>*</b></span
              ><input v-model="form.purchasePrice" type="number" min="0" step="0.01" required
            /></label>
            <label class="inventory-field"
              ><span class="inventory-field-label"
                >{{
                  productMode === 'pack'
                    ? 'Selling price per pack (PKR)'
                    : 'Selling price per unit (PKR)'
                }}
                <b>*</b></span
              ><input v-model="form.sellingPrice" type="number" min="0" step="0.01" required
            /></label>
            <label v-if="!editingId" class="inventory-field inventory-field--wide"
              >{{ productMode === 'pack' ? 'Initial stock (packs)' : 'Initial stock (units)' }}
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
                >Optional. Leave at 0 if you will add stock later.
                {{
                  productMode === 'pack'
                    ? 'Enter the number of full packs.'
                    : 'Enter the number of stock units.'
                }}
                Opening stock uses the purchase cost above and is recorded in the stock
                ledger.</small
              >
            </label>
          </div>
          <div class="inventory-section-heading">ADDITIONAL DETAILS</div>
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
              {{ formatStock(stockProduct) }}
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
            ><span class="inventory-field-label">Movement type <b>*</b></span
            ><select v-model="stockMovementType">
              <option value="receipt">Receive stock</option>
              <option value="adjustment">Stock adjustment</option>
              <option value="write_off">Write-off / damaged</option>
            </select></label
          >
          <label v-if="stockProduct.packSize > 1" class="inventory-field"
            >Quantity unit<select v-model="stockUnit" :disabled="stockMovementType === 'receipt'">
              <option value="pack">Full pack</option>
              <option value="single">Single {{ stockProduct.singleUnitName }}</option></select
            ><small v-if="stockMovementType === 'receipt'" class="inventory-unit-help"
              >Pack-only for purchase receipts. Select Stock adjustment or Write-off / damaged above
              to enable individual-cigarette quantities.</small
            ><small v-else class="inventory-unit-help"
              >Choose full packs or individual cigarettes. For an adjustment, select Add stock or
              Remove stock below and enter a positive quantity.</small
            ></label
          >
          <div
            v-if="stockMovementType === 'adjustment'"
            class="inventory-field inventory-adjustment-direction"
          >
            <span class="inventory-field-label">Adjustment direction <b>*</b></span>
            <div
              class="inventory-adjustment-options"
              role="group"
              aria-label="Adjustment direction"
            >
              <button
                type="button"
                class="inventory-adjustment-option"
                :class="{ 'is-selected': adjustmentDirection === 'add' }"
                :aria-pressed="adjustmentDirection === 'add'"
                @click="adjustmentDirection = 'add'"
              >
                <span aria-hidden="true">+</span> Add stock
              </button>
              <button
                type="button"
                class="inventory-adjustment-option inventory-adjustment-option--remove"
                :class="{ 'is-selected': adjustmentDirection === 'remove' }"
                :aria-pressed="adjustmentDirection === 'remove'"
                @click="adjustmentDirection = 'remove'"
              >
                <span aria-hidden="true">−</span> Remove stock
              </button>
            </div>
            <small class="inventory-unit-help"
              >Choose explicitly whether this correction increases or decreases on-hand
              stock.</small
            >
          </div>
          <label class="inventory-field"
            ><span class="inventory-field-label"
              >{{
                stockMovementType === 'adjustment'
                  ? `Quantity to ${adjustmentDirection === 'remove' ? 'remove' : 'add'}${stockUnit === 'single' ? ` in ${pluralizeUnit(stockProduct.singleUnitName)}` : ''}`
                  : `Quantity${stockUnit === 'single' ? ` in ${pluralizeUnit(stockProduct.singleUnitName)}` : ''}`
              }}
              <b>*</b></span
            ><input
              v-model="stockQuantity"
              type="number"
              :min="stockUnit === 'single' ? '1' : '0.001'"
              :step="stockUnit === 'single' ? 1 : 0.001"
              placeholder="1"
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
            ><span class="inventory-field-label">Reason / reference <b>*</b></span
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
