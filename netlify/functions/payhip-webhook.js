const SUPABASE_URL = "https://cbxqdeeawyfmqemiepeb.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Plan IDs from Payhip — pago único
const PLAN_MAP = {
  [process.env.PAYHIP_PRO_ID]: { plan: "pro", rutinas_limite: 5 },
  [process.env.PAYHIP_ELITE_ID]: { plan: "elite", rutinas_limite: 999999 }
};

// Primer día del mes siguiente
function nextMonthReset() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
}

// Payhip envía application/x-www-form-urlencoded, no JSON
function parseBody(body, contentType) {
  if (!body) return {};
  if (contentType && contentType.includes("application/json")) {
    try { return JSON.parse(body); } catch(e) { return {}; }
  }
  // form-urlencoded (formato Payhip)
  try {
    const params = new URLSearchParams(body);
    const obj = {};
    for (const [key, value] of params.entries()) obj[key] = value;
    return obj;
  } catch(e) {
    try { return JSON.parse(body); } catch(e2) { return {}; }
  }
}

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
    const payload = parseBody(event.body, contentType);
    console.log("Payhip webhook received:", JSON.stringify(payload));
    console.log("Content-Type:", contentType);

    const email = payload.buyer_email;
    const productId = payload.product_id;
    const orderId = payload.order_id || payload.id;

    if (!email) {
      console.log("Missing email in payload:", JSON.stringify(payload));
      return { statusCode: 400, body: "Missing email" };
    }

    const planInfo = PLAN_MAP[productId];
    if (!planInfo) {
      console.log("Unknown product ID:", productId, "— PLAN_MAP keys:", Object.keys(PLAN_MAP));
      return { statusCode: 200, body: "Unknown product, ignoring" };
    }

    // Check if user already exists
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=email`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await checkRes.json();

    if (existing && existing.length > 0) {
      // Usuario existente: upgrade o recompra
      await fetch(
        `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
        {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            plan: planInfo.plan,
            rutinas_limite: planInfo.rutinas_limite,
            rutinas_usadas: 0,
            fecha_reset: nextMonthReset(),
            activo: true,
            payhip_order_id: orderId
          })
        }
      );
    } else {
      // Nuevo usuario
      await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          plan: planInfo.plan,
          rutinas_usadas: 0,
          rutinas_limite: planInfo.rutinas_limite,
          fecha_reset: nextMonthReset(),
          activo: true,
          payhip_order_id: orderId
        })
      });
    }

    console.log(`User ${email} activated with plan ${planInfo.plan}`);
    return { statusCode: 200, body: "OK" };

  } catch (err) {
    console.error("payhip-webhook error:", err);
    return { statusCode: 500, body: "Internal error" };
  }
};
