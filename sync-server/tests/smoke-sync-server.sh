#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
STORE_ID="10000000-0000-4000-8000-000000000001"
COUNTER_ID="20000000-0000-4000-8000-000000000001"
uuid() { cat /proc/sys/kernel/random/uuid; }
PRODUCT_ID="$(uuid)"
SALE_ID="$(uuid)"
TOKEN="$(openssl rand -hex 32)"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-test-only-local-pass-6f1d9a0c}"
export SYNC_ADMIN_TOKEN="${SYNC_ADMIN_TOKEN:-local-test-admin-token-6f1d9a0c-7f5b}"
ADMIN_TOKEN="$SYNC_ADMIN_TOKEN"
AUTH_HEADER="Authorization: Bearer $TOKEN"
cd "$(dirname "$0")/.."

make_batch() {
  STORE_ID="$STORE_ID" COUNTER_ID="$COUNTER_ID" EVENT_ID="$1" EVENT_TYPE="$2" AGGREGATE_TYPE="$3" AGGREGATE_ID="$4" PAYLOAD="$5" CREATED_AT="${6:-$(date -u +%Y-%m-%dT%H:%M:%S.000Z)}" node -e 'console.log(JSON.stringify({schemaVersion:1,storeId:process.env.STORE_ID,counterId:process.env.COUNTER_ID,events:[{id:process.env.EVENT_ID,eventType:process.env.EVENT_TYPE,schemaVersion:1,aggregateType:process.env.AGGREGATE_TYPE,aggregateId:process.env.AGGREGATE_ID,payload:JSON.parse(process.env.PAYLOAD),createdAt:process.env.CREATED_AT}]}))'
}
assert_accepted() {
  RESPONSE="$1" EVENT_ID="$2" node -e 'const x=JSON.parse(process.env.RESPONSE);if(!x.acceptedEventIds?.includes(process.env.EVENT_ID)||x.rejectedEvents?.length){console.error(JSON.stringify(x));process.exit(1)}'
}
assert_rejected() {
  RESPONSE="$1" node -e 'const x=JSON.parse(process.env.RESPONSE);if(x.acceptedEventIds?.length||x.rejectedEvents?.[0]?.retryable!==false)process.exit(1)'
}

curl -fsS "$BASE_URL/healthz" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(!JSON.parse(s).ok)process.exit(1);console.log('PASS healthz')})"
docker compose exec -T sync-server node dist/provision-counter.js "$STORE_ID" "Integration Test Store" "$COUNTER_ID" "$TOKEN"

EVENT_ID="$(uuid)"
BODY="$(make_batch "$EVENT_ID" test.event test case-1 '{"amount":42}' '2026-01-01T00:00:00.000Z')"
FIRST="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$BODY" "$BASE_URL/api/v1/sync/events")"
assert_accepted "$FIRST" "$EVENT_ID"
echo "PASS authenticated event insert"
SECOND="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$BODY" "$BASE_URL/api/v1/sync/events")"
assert_accepted "$SECOND" "$EVENT_ID"
echo "PASS idempotent duplicate delivery"
CONFLICT_BODY="$(make_batch "$EVENT_ID" test.event test case-1 '{"amount":43}' '2026-01-01T00:00:00.000Z')"
CONFLICT="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$CONFLICT_BODY" "$BASE_URL/api/v1/sync/events")"
assert_rejected "$CONFLICT"
echo "PASS conflicting event ID rejected"
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d "$BODY" "$BASE_URL/api/v1/sync/events")"
test "$STATUS" = "401"
echo "PASS missing credentials rejected"
ADMIN_INVENTORY="$(curl -fsS -H "x-admin-token: $ADMIN_TOKEN" "$BASE_URL/api/v1/admin/inventory?storeId=$STORE_ID")"
printf '%s' "$ADMIN_INVENTORY" | STORE_ID="$STORE_ID" COUNTER_ID="$COUNTER_ID" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(x.store?.store_id!==process.env.STORE_ID)process.exit(1);if(!x.counters?.some(c=>c.counterId===process.env.COUNTER_ID))process.exit(1);console.log("PASS authenticated admin inventory endpoint")})'
curl -fsS "$BASE_URL/admin" | grep -q 'NOUVO POS Central Operations'
curl -fsS "$BASE_URL/admin.js" | grep -q 'x-admin-token'
echo "PASS central admin UI assets served"

SETTINGS_EVENT_ID="$(uuid)"
SETTINGS_PAYLOAD="$(printf '{"schemaVersion":1,"settings":{"storeId":"%s","name":"Updated Integration Store","currencyCode":"PKR","timezone":"Asia/Karachi","taxBehavior":"exclusive","address":"Market Road","phone":"03001234567","businessRegistrationNumber":"REG-1","receiptFooter":"Thank you","receiptPaperWidthMm":80}}' "$STORE_ID")"
SETTINGS_BODY="$(make_batch "$SETTINGS_EVENT_ID" store.settings.updated store "$STORE_ID" "$SETTINGS_PAYLOAD")"
SETTINGS_RESULT="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$SETTINGS_BODY" "$BASE_URL/api/v1/sync/events")"
assert_accepted "$SETTINGS_RESULT" "$SETTINGS_EVENT_ID"
echo "PASS store settings synchronization"

PRODUCT_EVENT_ID="$(uuid)"
PRODUCT_PAYLOAD="$(printf '{"schemaVersion":1,"product":{"id":"%s","name":"Test Water","description":"","categoryName":"Drinks","sku":"WATER-%s","barcodes":["%s"],"baseUnit":"piece","purchaseCostMinor":50,"sellingPriceMinor":100,"taxRateBasisPoints":0,"isActive":true,"stockOnHandMilli":0,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}' "$PRODUCT_ID" "${PRODUCT_ID:0:8}" "${PRODUCT_ID:0:12}")"
PRODUCT_BODY="$(make_batch "$PRODUCT_EVENT_ID" product.created product "$PRODUCT_ID" "$PRODUCT_PAYLOAD")"
PRODUCT_RESULT="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$PRODUCT_BODY" "$BASE_URL/api/v1/sync/events")"
assert_accepted "$PRODUCT_RESULT" "$PRODUCT_EVENT_ID"
echo "PASS validated product snapshot ingestion"

MOVEMENT_ID="$(uuid)"
MOVEMENT_EVENT_ID="$(uuid)"
MOVEMENT_PAYLOAD="$(printf '{"schemaVersion":1,"movementId":"%s","storeId":"%s","counterId":"%s","productId":"%s","movementType":"receipt","quantityDeltaMilli":1000,"unitCostMinor":50,"reason":"Integration receipt"}' "$MOVEMENT_ID" "$STORE_ID" "$COUNTER_ID" "$PRODUCT_ID")"
MOVEMENT_BODY="$(make_batch "$MOVEMENT_EVENT_ID" stock.movement.recorded stock_movement "$MOVEMENT_ID" "$MOVEMENT_PAYLOAD")"
MOVEMENT_RESULT="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$MOVEMENT_BODY" "$BASE_URL/api/v1/sync/events")"
assert_accepted "$MOVEMENT_RESULT" "$MOVEMENT_EVENT_ID"
DUP_MOVEMENT_EVENT_ID="$(uuid)"
DUP_MOVEMENT_BODY="$(make_batch "$DUP_MOVEMENT_EVENT_ID" stock.movement.recorded stock_movement "$MOVEMENT_ID" "$MOVEMENT_PAYLOAD")"
DUP_MOVEMENT_RESULT="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$DUP_MOVEMENT_BODY" "$BASE_URL/api/v1/sync/events")"
assert_accepted "$DUP_MOVEMENT_RESULT" "$DUP_MOVEMENT_EVENT_ID"
CENTRAL_QTY="$(docker compose exec -T postgres psql -U nouvo_sync -d nouvo_sync -Atc "SELECT on_hand_quantity_milli FROM sync_inventory WHERE store_id='$STORE_ID' AND product_id='$PRODUCT_ID';")"
test "$CENTRAL_QTY" = "1000"
echo "PASS stock movement business ID is idempotent"

curl -fsS -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' -d "{\"storeId\":\"$STORE_ID\",\"productId\":\"$PRODUCT_ID\",\"deltaQuantityMilli\":9000,\"reason\":\"Initial integration test stock\"}" "$BASE_URL/api/v1/admin/inventory/adjustment" >/dev/null
curl -fsS -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' -d "{\"storeId\":\"$STORE_ID\",\"counterId\":\"$COUNTER_ID\",\"productId\":\"$PRODUCT_ID\",\"allocatedQuantityMilli\":6000}" "$BASE_URL/api/v1/admin/allocations" >/dev/null
echo "PASS central stock adjustment and allocation"

SALE_EVENT_ID="$(uuid)"
SALE_PAYLOAD="$(printf '{"schemaVersion":1,"sale":{"id":"%s","lines":[{"productId":"%s","quantityMilli":4000}]}}' "$SALE_ID" "$PRODUCT_ID")"
SALE_BODY="$(make_batch "$SALE_EVENT_ID" sale.completed sale "$SALE_ID" "$SALE_PAYLOAD")"
SALE_RESULT="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$SALE_BODY" "$BASE_URL/api/v1/sync/events")"
assert_accepted "$SALE_RESULT" "$SALE_EVENT_ID"
echo "PASS sale consumes stock allocation"

RETURN_ID="$(uuid)"
RETURN_EVENT_ID="$(uuid)"
RETURN_PAYLOAD="$(printf '{"returnId":"%s","saleId":"%s","operation":"return","lines":[{"saleLineId":"%s","productId":"%s","quantityMilli":1000,"refundTotalMinor":100}]}' "$RETURN_ID" "$SALE_ID" "$(uuid)" "$PRODUCT_ID")"
RETURN_BODY="$(make_batch "$RETURN_EVENT_ID" sale.return.completed sale_return "$RETURN_ID" "$RETURN_PAYLOAD")"
RETURN_RESULT="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$RETURN_BODY" "$BASE_URL/api/v1/sync/events")"
assert_accepted "$RETURN_RESULT" "$RETURN_EVENT_ID"
echo "PASS return restores central inventory and allocation"

DUP_RETURN_EVENT_ID="$(uuid)"
DUP_RETURN_BODY="$(make_batch "$DUP_RETURN_EVENT_ID" sale.return.completed sale_return "$RETURN_ID" "$RETURN_PAYLOAD")"
DUP_RETURN="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$DUP_RETURN_BODY" "$BASE_URL/api/v1/sync/events")"
assert_rejected "$DUP_RETURN"
echo "PASS duplicate return cannot inflate stock"

SNAPSHOT="$(curl -fsS -H "$AUTH_HEADER" -H "x-counter-id: $COUNTER_ID" "$BASE_URL/api/v1/sync/snapshot")"
printf '%s' "$SNAPSHOT" | PRODUCT_ID="$PRODUCT_ID" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(x.allocations?.find(a=>a.productId===process.env.PRODUCT_ID)?.quantityMilli!==3000)process.exit(1);if(!x.products?.find(p=>p.id===process.env.PRODUCT_ID)?.barcodes?.length)process.exit(1);if(x.settings?.name!=="Updated Integration Store"||x.settings?.receiptPaperWidthMm!==80)process.exit(1);console.log("PASS settings, product/barcode snapshot and remaining allocation")})'

OVERSELL_ID="$(uuid)"
OVERSELL_EVENT_ID="$(uuid)"
OVERSELL_PAYLOAD="$(printf '{"schemaVersion":1,"sale":{"id":"%s","lines":[{"productId":"%s","quantityMilli":4000}]}}' "$OVERSELL_ID" "$PRODUCT_ID")"
OVERSELL_BODY="$(make_batch "$OVERSELL_EVENT_ID" sale.completed sale "$OVERSELL_ID" "$OVERSELL_PAYLOAD")"
OVERSELL="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$OVERSELL_BODY" "$BASE_URL/api/v1/sync/events")"
assert_rejected "$OVERSELL"
echo "PASS sale exceeding allocation is rejected"

ALLOCATION_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' -d "{\"storeId\":\"$STORE_ID\",\"counterId\":\"$COUNTER_ID\",\"productId\":\"$PRODUCT_ID\",\"allocatedQuantityMilli\":12000}" "$BASE_URL/api/v1/admin/allocations")"
test "$ALLOCATION_STATUS" = "409"
echo "PASS allocation cannot exceed unreserved central stock"

CONFLICTS="$(curl -fsS -H "x-admin-token: $ADMIN_TOKEN" "$BASE_URL/api/v1/admin/conflicts?storeId=$STORE_ID")"
CONFLICT_ID="$(printf '%s' "$CONFLICTS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(!x.conflicts?.length)process.exit(1);process.stdout.write(String(x.conflicts[0].id))})')"
curl -fsS -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' -d "{\"storeId\":\"$STORE_ID\",\"conflictId\":$CONFLICT_ID,\"resolutionNote\":\"Verified by sync integration test\"}" "$BASE_URL/api/v1/admin/conflicts/resolve" >/dev/null
echo "PASS conflict listing and audited resolution"

ARCHIVE_EVENT_ID="$(uuid)"
ARCHIVE_PAYLOAD="$(printf '{"schemaVersion":1,"productId":"%s"}' "$PRODUCT_ID")"
ARCHIVE_BODY="$(make_batch "$ARCHIVE_EVENT_ID" product.archived product "$PRODUCT_ID" "$ARCHIVE_PAYLOAD")"
ARCHIVE_RESULT="$(curl -fsS -H "$AUTH_HEADER" -H 'content-type: application/json' -d "$ARCHIVE_BODY" "$BASE_URL/api/v1/sync/events")"
assert_accepted "$ARCHIVE_RESULT" "$ARCHIVE_EVENT_ID"
ARCHIVED_SNAPSHOT="$(curl -fsS -H "$AUTH_HEADER" -H "x-counter-id: $COUNTER_ID" "$BASE_URL/api/v1/sync/snapshot")"
printf '%s' "$ARCHIVED_SNAPSHOT" | PRODUCT_ID="$PRODUCT_ID" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(x.products?.find(p=>p.id===process.env.PRODUCT_ID)?.isActive!==false)process.exit(1);if(x.allocations?.some(a=>a.productId===process.env.PRODUCT_ID))process.exit(1);console.log("PASS archive disables product and releases allocation")})'
echo "All central sync API integration checks passed."
