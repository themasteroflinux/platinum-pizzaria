// Cloudflare Pages Function: create an order on the self-hosted GNU Taler merchant.
// Set TALER_BACKEND_URL to the HTTPS base URL of the default/admin instance.
// Keep the machine access token in the encrypted TALER_API_TOKEN secret only.
const UNIT_PRICE = 5;
const QUANTITY_FIELDS = ["personpizza", "onemancombo", "gpizza", "garbread"];

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  const requestUrl = new URL(request.url);
  if (origin && origin !== requestUrl.origin) {
    return json({ error: "Request origin not allowed." }, 403);
  }

  if (!env.TALER_API_TOKEN) {
    return json({ error: "GNU Taler is not configured on the server." }, 503);
  }

  let backendUrl = String(env.TALER_BACKEND_URL || "").trim();
  while (backendUrl.endsWith("/")) backendUrl = backendUrl.slice(0, -1);
  if (!backendUrl.startsWith("https://")) {
    return json({ error: "GNU Taler checkout is waiting for its HTTPS merchant URL. Set TALER_BACKEND_URL after the secure proxy is ready." }, 503);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Invalid JSON request." }, 400);
  }

  const customerName = String(input.name || "").trim().slice(0, 100);
  const driver = String(input.driver || "").trim().slice(0, 100);
  if (!customerName || !driver) {
    return json({ error: "Please provide an order name and driver." }, 400);
  }

  const quantities = {};
  for (const field of QUANTITY_FIELDS) {
    const value = Number(input[field] || 0);
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      return json({ error: "Invalid quantity for " + field + "." }, 400);
    }
    quantities[field] = value;
  }

  const totalItems = Object.values(quantities).reduce((sum, value) => sum + value, 0);
  if (totalItems < 1) {
    return json({ error: "Please select at least one menu item." }, 400);
  }

  const total = totalItems * UNIT_PRICE;
  const itemSummary = [
    quantities.personpizza ? quantities.personpizza + " Personal Pizza" : "",
    quantities.onemancombo ? quantities.onemancombo + " One Man Combo" : "",
    quantities.gpizza ? quantities.gpizza + " Group Pizza" : "",
    quantities.garbread ? quantities.garbread + " Garlic Bread" : ""
  ].filter(Boolean).join(", ");

  const fulfillment = new URL("/thanks.html", requestUrl.origin);
  fulfillment.searchParams.set("driver", driver);
  fulfillment.searchParams.set("name", customerName);
  const fulfillmentUrl = fulfillment.toString() + "&order_id=${ORDER_ID}";

  let token = String(env.TALER_API_TOKEN).trim();
  if (token.toLowerCase().startsWith("bearer ")) token = token.slice(7).trim();
  let upstream;
  try {
    upstream = await fetch(backendUrl + "/private/orders", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        order: {
          amount: "KUDOS:" + total.toFixed(2),
          summary: "Platinum Pizzaria: " + itemSummary,
          fulfillment_url: fulfillmentUrl
        },
        create_token: false
      })
    });
  } catch {
    return json({ error: "Could not reach the GNU Taler merchant backend." }, 502);
  }

  let result = {};
  try { result = await upstream.json(); } catch {}
  if (!upstream.ok || !result.order_id) {
    const detail = result.detail || result.message;
    return json({
      error: detail ? "GNU Taler rejected the order: " + String(detail).slice(0, 300) :
        "GNU Taler rejected the order (HTTP " + upstream.status + ")."
    }, 502);
  }

  const orderId = String(result.order_id);
  return json({
    order_id: orderId,
    amount: "KUDOS:" + total.toFixed(2),
    backend_url: backendUrl,
    payment_url: backendUrl + "/orders/" + encodeURIComponent(orderId)
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
