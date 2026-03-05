const SUPABASE_URL = "https://cbxqdeeawyfmqemiepeb.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const jsonHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const { email, action } = JSON.parse(event.body || "{}");
    const authHeader = event.headers["authorization"] || "";
    const token = authHeader.replace("Bearer ", "");

    if (!email || !token) {
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: "Datos incompletos" }) };
    }

    // Verificar usuario
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=email,plan,rutinas_usadas,rutinas_limite,activo,fecha_reset`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const users = await userRes.json();

    if (!users || users.length === 0) {
      return { statusCode: 403, headers: jsonHeaders, body: JSON.stringify({ error: "Usuario no encontrado" }) };
    }
    const user = users[0];

    if (!user.activo) {
      return { statusCode: 403, headers: jsonHeaders, body: JSON.stringify({ error: "Cuenta no activa" }) };
    }

    // Reset mensual
    if (user.plan !== "elite" && user.fecha_reset && new Date() >= new Date(user.fecha_reset)) {
      const nextReset = new Date();
      nextReset.setMonth(nextReset.getMonth() + 1);
      nextReset.setDate(1);
      nextReset.setHours(0, 0, 0, 0);
      await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rutinas_usadas: 0, fecha_reset: nextReset.toISOString() })
      });
      user.rutinas_usadas = 0;
    }

    if (user.plan !== "elite" && user.rutinas_usadas >= (user.rutinas_limite || 5)) {
      return { statusCode: 403, headers: jsonHeaders, body: JSON.stringify({ error: "Has alcanzado el límite de rutinas de tu plan este mes." }) };
    }

    // Si es verify, devolver token de Anthropic para uso directo
    if (action === "verify") {
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({
          verified: true,
          apiKey: ANTHROPIC_KEY,
          plan: user.plan,
          rutinas_usadas: user.rutinas_usadas,
          rutinas_limite: user.rutinas_limite
        })
      };
    }

    // Si es increment, incrementar contador
    if (action === "increment") {
      if (user.plan !== "elite") {
        await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
          method: "PATCH",
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ rutinas_usadas: user.rutinas_usadas + 1 })
        });
      }
      return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: "Acción no válida" }) };

  } catch (err) {
    console.error("generate-routine error:", err.message);
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ error: "Error interno: " + err.message }) };
  }
};
