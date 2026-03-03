const SUPABASE_URL = "https://cbxqdeeawyfmqemiepeb.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const { prompt, email } = JSON.parse(event.body || "{}");
    const authHeader = event.headers["authorization"] || "";
    const token = authHeader.replace("Bearer ", "");

    if (!prompt || !email || !token) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Datos incompletos" }) };
    }

    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=email,plan,rutinas_usadas,rutinas_limite,activo`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const users = await userRes.json();

    if (!users || users.length === 0) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Usuario no encontrado" }) };
    }
    const user = users[0];
    if (!user.activo) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Cuenta no activa" }) };
    }
    if (user.plan !== "elite" && user.rutinas_usadas >= (user.rutinas_limite || 5)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Has alcanzado el límite de rutinas de tu plan este mes." }) };
    }

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 6000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiData.error?.message || "Error de IA");

    if (user.plan !== "elite") {
      await fetch(
        `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
        {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ rutinas_usadas: user.rutinas_usadas + 1 })
        }
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text: aiData.content[0].text })
    };

  } catch (err) {
    console.error("generate-routine error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Error interno del servidor" }) };
  }
};
