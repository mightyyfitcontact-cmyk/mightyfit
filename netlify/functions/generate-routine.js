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

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  };

  try {
    const { prompt, email } = JSON.parse(event.body || "{}");
    const authHeader = event.headers["authorization"] || "";
    const token = authHeader.replace("Bearer ", "");

    if (!prompt || !email || !token) {
      return { statusCode: 400, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ error: "Datos incompletos" }) };
    }

    // 1. Verificar usuario en Supabase
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=email,plan,rutinas_usadas,rutinas_limite,activo,fecha_reset`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const users = await userRes.json();

    if (!users || users.length === 0) {
      return { statusCode: 403, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ error: "Usuario no encontrado" }) };
    }
    const user = users[0];

    if (!user.activo) {
      return { statusCode: 403, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ error: "Cuenta no activa" }) };
    }

    // Reset mensual
    if (user.plan !== "elite" && user.fecha_reset && new Date() >= new Date(user.fecha_reset)) {
      const nextReset = new Date();
      nextReset.setMonth(nextReset.getMonth() + 1);
      nextReset.setDate(1);
      nextReset.setHours(0, 0, 0, 0);
      await fetch(
        `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
        {
          method: "PATCH",
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ rutinas_usadas: 0, fecha_reset: nextReset.toISOString() })
        }
      );
      user.rutinas_usadas = 0;
    }

    if (user.plan !== "elite" && user.rutinas_usadas >= (user.rutinas_limite || 5)) {
      return { statusCode: 403, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, body: JSON.stringify({ error: "Has alcanzado el límite de rutinas de tu plan este mes." }) };
    }

    // 2. Llamar a Claude con streaming
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
        stream: true,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!aiRes.ok) {
      const errData = await aiRes.json();
      throw new Error(errData.error?.message || "Error de IA");
    }

    // 3. Leer el stream y acumular el texto completo
    const reader = aiRes.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "content_block_delta" && parsed.delta?.text) {
              fullText += parsed.delta.text;
            }
          } catch (e) {}
        }
      }
    }

    // 4. Incrementar contador si no es elite
    if (user.plan !== "elite") {
      await fetch(
        `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
        {
          method: "PATCH",
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ rutinas_usadas: user.rutinas_usadas + 1 })
        }
      );
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ text: fullText })
    };

  } catch (err) {
    console.error("generate-routine error:", err.message);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Error interno: " + err.message })
    };
  }
};
