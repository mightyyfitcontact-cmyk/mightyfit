const SUPABASE_URL = "https://cbxqdeeawyfmqemiepeb.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const PLAN_MAP = {
  [process.env.PAYHIP_PRO_ID]: { plan: "pro", rutinas_limite: 5 },
  [process.env.PAYHIP_ELITE_ID]: { plan: "elite", rutinas_limite: 9999 }
};

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    console.log("Payhip webhook received:", JSON.stringify(payload));

    const email = payload.buyer_email;
    const productId = payload.product_id;
    const orderId = payload.order_id || payload.id;

    if (!email) {
      return { statusCode: 400, body: "Missing email" };
    }

    const planInfo = PLAN_MAP[productId];
    if (!planInfo) {
      console.log("Unknown product ID:", productId);
      return { statusCode: 200, body: "Unknown product, ignoring" };
    }

    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=email`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await checkRes.json();

    const userData = {
      email,
      plan: planInfo.plan,
      rutinas_usadas: 0,
      rutinas_limite: planInfo.rutinas_limite,
      fecha_reset: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
      activo: true,
      payhip_order_id: orderId
    };

    if (existing && existing.length > 0) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
        {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ plan: planInfo.plan, rutinas_limite: planInfo.rutinas_limite, activo: true, rutinas_usadas: 0, payhip_order_id: orderId })
        }
      );
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(userData)
      });
    }

    console.log(`User ${email} activated with plan ${planInfo.plan}`);
    return { statusCode: 200, body: "OK" };

  } catch (err) {
    console.error("payhip-webhook error:", err);
    return { statusCode: 500, body: "Internal error" };
  }
};
